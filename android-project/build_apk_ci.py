#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Compilador Portátil (Linux GitHub Actions + Windows Local) do APK Nativo:
SAMU 192 – Orlândia-SP (SAMU_192_Orlandia.apk)
"""

import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WEB_DIR = os.path.join(REPO_ROOT, "web-app")
ANDROID_PROJECT = os.path.join(REPO_ROOT, "android-project")
APP_MAIN = os.path.join(ANDROID_PROJECT, "app", "src", "main")
ASSETS_WWW = os.path.join(APP_MAIN, "assets", "www")
VERSION_JSON_PATH = os.path.join(REPO_ROOT, "version.json")
FINAL_APK = os.path.join(REPO_ROOT, "SAMU_192_Orlandia.apk")
KEYSTORE_PATH = os.path.join(ANDROID_PROJECT, "samu_orlandia_release.jks")

IS_WIN = os.name == "nt"
EXE = ".exe" if IS_WIN else ""


def find_java_tool(tool_name):
    candidates = []
    java_home = os.environ.get("JAVA_HOME", "")
    if java_home:
        candidates.append(os.path.join(java_home, "bin", tool_name + EXE))
    if IS_WIN:
        candidates.append(os.path.join(r"C:\Program Files\Android\Android Studio\jbr\bin", tool_name + EXE))
        candidates.append(os.path.join(r"C:\Program Files\Android\Android Studio\jre\bin", tool_name + EXE))
        for pattern in (
            r"C:\Program Files\Eclipse Adoptium\jdk*\bin",
            r"C:\Program Files\Java\jdk*\bin",
            r"C:\Program Files\Microsoft\jdk*\bin",
        ):
            for hit_dir in sorted(glob.glob(pattern), reverse=True):
                candidates.append(os.path.join(hit_dir, tool_name + EXE))
    which_hit = shutil.which(tool_name)
    if which_hit:
        candidates.append(which_hit)
    for c in candidates:
        if c and os.path.exists(c):
            return c
    raise RuntimeError(f"Ferramenta Java '{tool_name}' nao encontrada.")


def find_sdk_root():
    for env_key in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        val = os.environ.get(env_key, "")
        if val and os.path.isdir(val):
            return val
    portable_sdk = os.path.join(REPO_ROOT, ".android-sdk")
    if os.path.isdir(portable_sdk):
        return portable_sdk
    if IS_WIN:
        local_app = os.environ.get("LOCALAPPDATA", r"C:\Users\Guilh\AppData\Local")
        for candidate in (
            os.path.join(local_app, "Android", "Sdk"),
            r"C:\Android\Sdk",
            r"C:\Android\sdk",
        ):
            if os.path.isdir(candidate):
                return candidate
    raise RuntimeError("Android SDK nao encontrado (defina ANDROID_HOME ou ANDROID_SDK_ROOT).")


def has_local_build_environment():
    try:
        find_java_tool("java")
        find_java_tool("javac")
        find_java_tool("keytool")
        sdk_root = find_sdk_root()
        platforms = glob.glob(os.path.join(sdk_root, "platforms", "android-*", "android.jar"))
        btools = [d for d in glob.glob(os.path.join(sdk_root, "build-tools", "*")) if os.path.isdir(d)]
        return bool(platforms and btools)
    except Exception:
        return False


def run_step(name, cmd, env=None):
    print(f"\n=== {name} ===")
    res = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if res.stdout.strip():
        print(res.stdout.strip())
    if res.returncode != 0:
        print("STDERR:", res.stderr.strip())
        raise RuntimeError(f"Falha na etapa '{name}' (codigo {res.returncode})")


def main():
    java_exe = find_java_tool("java")
    javac_exe = find_java_tool("javac")
    keytool_exe = find_java_tool("keytool")
    sdk_root = find_sdk_root()

    platforms = sorted(glob.glob(os.path.join(sdk_root, "platforms", "android-*", "android.jar")))
    if not platforms:
        raise RuntimeError(f"Nenhum android.jar encontrado em {sdk_root}/platforms")
    android_jar = platforms[-1]

    btools_dirs = sorted([d for d in glob.glob(os.path.join(sdk_root, "build-tools", "*")) if os.path.isdir(d)])
    if not btools_dirs:
        raise RuntimeError(f"Nenhum build-tools encontrado em {sdk_root}/build-tools")
    bt_dir = btools_dirs[-1]

    aapt2_exe = os.path.join(bt_dir, "aapt2" + EXE)
    zipalign_exe = os.path.join(bt_dir, "zipalign" + EXE)
    d8_jar = os.path.join(bt_dir, "lib", "d8.jar")
    apksigner_jar = os.path.join(bt_dir, "lib", "apksigner.jar")

    print("Java:", java_exe)
    print("android.jar:", android_jar)
    print("build-tools:", bt_dir)

    # 1. Le versao atual de version.json
    with open(VERSION_JSON_PATH, "r", encoding="utf-8") as f:
        ver_info = json.load(f)
    ver_code = int(ver_info.get("apkVersionCode", 1))
    ver_name = str(ver_info.get("apkVersionName", "1.0.0"))
    ota_rev = int(ver_info.get("otaRevision", 1))
    print(f"Compilando versao v{ver_name} (versionCode={ver_code}, otaRevision={ota_rev})...")

    # 2. Sincroniza web-app + version.json para assets/www
    if os.path.exists(ASSETS_WWW):
        shutil.rmtree(ASSETS_WWW)
    shutil.copytree(WEB_DIR, ASSETS_WWW)
    shutil.copy2(VERSION_JSON_PATH, os.path.join(ASSETS_WWW, "version.json"))

    build_dir = tempfile.mkdtemp(prefix="samu_apk_build_")
    try:
        gen_dir = os.path.join(build_dir, "gen")
        classes_dir = os.path.join(build_dir, "classes")
        dex_dir = os.path.join(build_dir, "dex")
        os.makedirs(gen_dir, exist_ok=True)
        os.makedirs(classes_dir, exist_ok=True)
        os.makedirs(dex_dir, exist_ok=True)

        # Prepara AndroidManifest.xml com versionCode e versionName sincronizados
        manifest_src = os.path.join(APP_MAIN, "AndroidManifest.xml")
        with open(manifest_src, "r", encoding="utf-8") as mf:
            manifest_xml = mf.read()
        manifest_xml = re.sub(r'android:versionCode="\d+"', f'android:versionCode="{ver_code}"', manifest_xml)
        manifest_xml = re.sub(r'android:versionName="[^"]+"', f'android:versionName="{ver_name}"', manifest_xml)
        manifest_tmp = os.path.join(build_dir, "AndroidManifest.xml")
        with open(manifest_tmp, "w", encoding="utf-8") as mf:
            mf.write(manifest_xml)

        # 3. aapt2 compile
        compiled_res_zip = os.path.join(build_dir, "compiled_res.zip")
        run_step("aapt2 compile", [
            aapt2_exe, "compile",
            "--dir", os.path.join(APP_MAIN, "res"),
            "-o", compiled_res_zip
        ])

        # 4. aapt2 link
        unaligned_apk = os.path.join(build_dir, "unaligned_unsigned.apk")
        run_step("aapt2 link", [
            aapt2_exe, "link",
            "-I", android_jar,
            "--manifest", manifest_tmp,
            "-A", os.path.join(APP_MAIN, "assets"),
            "--java", gen_dir,
            "--min-sdk-version", "24",
            "--target-sdk-version", "34",
            "-o", unaligned_apk,
            compiled_res_zip
        ])

        # 5. javac
        java_sources = []
        for root, _, files in os.walk(gen_dir):
            for fn in files:
                if fn.endswith(".java"):
                    java_sources.append(os.path.join(root, fn))
        for root, _, files in os.walk(os.path.join(APP_MAIN, "java")):
            for fn in files:
                if fn.endswith(".java"):
                    java_sources.append(os.path.join(root, fn))

        run_step("javac", [
            javac_exe,
            "-source", "11",
            "-target", "11",
            "-encoding", "UTF-8",
            "-classpath", android_jar,
            "-d", classes_dir
        ] + java_sources)

        classes_jar = os.path.join(build_dir, "classes.jar")
        with zipfile.ZipFile(classes_jar, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, _, files in os.walk(classes_dir):
                for fn in files:
                    if fn.endswith(".class"):
                        full_p = os.path.join(root, fn)
                        rel_p = os.path.relpath(full_p, classes_dir).replace("\\", "/")
                        zf.write(full_p, rel_p)

        # 6. d8 -> classes.dex
        run_step("d8 dexing", [
            java_exe, "-cp", d8_jar,
            "com.android.tools.r8.D8",
            "--lib", android_jar,
            "--min-api", "24",
            "--output", dex_dir,
            classes_jar
        ])

        dex_file = os.path.join(dex_dir, "classes.dex")
        if not os.path.exists(dex_file):
            raise RuntimeError("classes.dex nao foi gerado!")

        with zipfile.ZipFile(unaligned_apk, "a") as zf:
            zf.write(dex_file, "classes.dex", compress_type=zipfile.ZIP_DEFLATED)
            names = zf.namelist()
            assert "assets/www/index.html" in names, "Faltando assets/www/index.html no APK!"
            assert "assets/www/version.json" in names, "Faltando assets/www/version.json no APK!"
            assert "classes.dex" in names, "Faltando classes.dex no APK!"

        # 7. zipalign
        aligned_apk = os.path.join(build_dir, "aligned_unsigned.apk")
        run_step("zipalign", [
            zipalign_exe, "-f", "-p", "4",
            unaligned_apk, aligned_apk
        ])

        # 8. Keystore consistente (permite atualizacao por cima no Android sem conflito de assinatura!)
        if not os.path.exists(KEYSTORE_PATH):
            run_step("keytool generate keystore", [
                keytool_exe, "-genkeypair",
                "-keystore", KEYSTORE_PATH,
                "-alias", "samu192",
                "-keyalg", "RSA",
                "-keysize", "2048",
                "-validity", "10000",
                "-storepass", "samu192orlandia",
                "-keypass", "samu192orlandia",
                "-dname", "CN=SAMU 192 Orlandia, OU=USB, O=SAMU Orlandia SP, L=Orlandia, ST=SP, C=BR"
            ])

        run_step("apksigner sign", [
            java_exe, "-jar", apksigner_jar,
            "sign",
            "--ks", KEYSTORE_PATH,
            "--ks-key-alias", "samu192",
            "--ks-pass", "pass:samu192orlandia",
            "--key-pass", "pass:samu192orlandia",
            "--out", FINAL_APK,
            aligned_apk
        ])

        run_step("apksigner verify", [
            java_exe, "-jar", apksigner_jar,
            "verify", "--verbose", FINAL_APK
        ])

        print(f"\nSUCESSO! APK assinado gerado em: {FINAL_APK} ({os.path.getsize(FINAL_APK)} bytes)")
    finally:
        shutil.rmtree(build_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
