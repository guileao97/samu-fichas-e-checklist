#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Publicador Direto para o GitHub + Validador Google Drive (Zero necessidade de instalar Git no Windows!)
Repositório Público de Auto-Update (somente código/instalador, ZERO dados de pacientes):
https://github.com/guileao97/samu-fichas-e-checklist

Arquitetura Oficial SAMU 192 – Orlândia-SP:
1. Google Drive / Google Apps Script (pré-configurado de fábrica no APK):
   - Sincroniza 100% dos dados operacionais em tempo real (logins, cadastros, aprovações, cargos híbridos,
     equipes do plantão, ficha compartilhada em tempo real, avarias, recebedores, médicos reguladores, CPFs e PDFs)
     SEM PRECISAR DE TOKEN EM NENHUM CELULAR!
2. GitHub Público (somente código do app, version.json e Releases SAMU_192_Orlandia.apk):
   - Permite que 100% dos celulares verifiquem e baixem atualizações automáticas (Live OTA e Novo .APK)
     SEM PRECISAR DE TOKEN EM NENHUM CELULAR, e sem expor nenhum dado sensível no GitHub!
"""

import argparse
import base64
import datetime
import importlib.util
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

OWNER = "guileao97"
REPO = "samu-fichas-e-checklist"
BRANCH = "main"

ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
TOKEN_FILE = os.path.join(ROOT_DIR, ".github_token.local")
DRIVE_URL_FILE = os.path.join(ROOT_DIR, ".drive_url.local")
VERSION_FILE = os.path.join(ROOT_DIR, "version.json")
STORAGE_JS_FILE = os.path.join(ROOT_DIR, "web-app", "js", "storage.js")

# Pastas e arquivos incluídos no repositório público de atualização (ZERO base_dados_samu.json e ZERO .jks!)
INCLUDE_DIRS = ("web-app", "android-project", "google-drive-integracao", ".github")
INCLUDE_ROOT_FILES = ("version.json", ".gitignore", "PUBLICAR_NO_GITHUB.py", "PUBLICAR_ATUALIZACAO_GITHUB.bat")

EXCLUDE_NAMES = {
    ".github_token.local",
    ".drive_url.local",
    "base_dados_samu.json",
    "samu_orlandia_release.jks",
    "__pycache__",
    ".DS_Store",
    "Thumbs.db",
    "SAMU_192_Orlandia.apk",
}


def gh_api(method, path, token, payload=None, return_headers=False):
    url = f"https://api.github.com{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "SAMU192-Orlandia-Publisher/2.0")
    if data is not None:
        req.add_header("Content-Type", "application/json; charset=utf-8")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            parsed = json.loads(raw) if raw else {}
            if return_headers:
                return resp.status, parsed, dict(resp.headers.items())
            return resp.status, parsed
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"message": body}
        if return_headers:
            return err.code, parsed, dict(err.headers.items()) if err.headers else {}
        return err.code, parsed


def read_embedded_drive_url():
    if os.path.isfile(DRIVE_URL_FILE):
        try:
            with open(DRIVE_URL_FILE, "r", encoding="utf-8") as f:
                saved = f.read().strip()
                if saved.startswith("https://script.google.com/"):
                    write_embedded_drive_url(saved)
                    return saved
        except Exception:
            pass
    if os.path.isfile(STORAGE_JS_FILE):
        with open(STORAGE_JS_FILE, "r", encoding="utf-8") as f:
            txt = f.read()
        m = re.search(r"const\s+DEFAULT_SCRIPT_URL\s*=\s*'([^']*)'\s*;", txt)
        if m:
            return m.group(1).strip()
    return ""


def write_embedded_drive_url(new_url):
    clean = str(new_url or "").strip()
    if not clean:
        return
    try:
        with open(DRIVE_URL_FILE, "w", encoding="utf-8") as f:
            f.write(clean)
    except Exception:
        pass
    if os.path.isfile(STORAGE_JS_FILE):
        with open(STORAGE_JS_FILE, "r", encoding="utf-8") as f:
            txt = f.read()
        updated, cnt = re.subn(
            r"(const\s+DEFAULT_SCRIPT_URL\s*=\s*')([^']*)('\s*;)",
            lambda m: f"{m.group(1)}{clean}{m.group(3)}",
            txt,
            count=1,
        )
        if cnt > 0 and updated != txt:
            with open(STORAGE_JS_FILE, "w", encoding="utf-8") as f:
                f.write(updated)


def ping_drive_script(script_url):
    if not script_url:
        return False, {"error": "URL vazia"}
    sep = "&" if "?" in script_url else "?"
    ping_url = f"{script_url}{sep}action=ping&_ts={int(time.time())}"
    req = urllib.request.Request(ping_url, method="GET")
    req.add_header("User-Agent", "SAMU192-Orlandia-Publisher/2.0")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            parsed = json.loads(raw)
            return bool(parsed.get("ok")), parsed
    except Exception as exc:
        return False, {"error": str(exc)}


def post_drive_script(script_url, payload):
    if not script_url:
        return False, {"error": "URL vazia"}
    raw_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(script_url, data=raw_body, method="POST")
    req.add_header("Content-Type", "text/plain;charset=utf-8")
    req.add_header("User-Agent", "SAMU192-Orlandia-Publisher/2.0")
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            parsed = json.loads(raw)
            return bool(parsed.get("ok")), parsed
    except Exception as exc:
        return False, {"error": str(exc)}


def verify_and_embed_drive_script_url(interactive=True):
    script_url = read_embedded_drive_url()
    while True:
        if script_url:
            print(f"☁️ Verificando conexão com Google Drive ({script_url[:62]}...)...")
            ok, info = ping_drive_script(script_url)
            if ok and info.get("syncDatabaseReady") is True and info.get("deleteRecordReady") is True:
                write_embedded_drive_url(script_url)
                print("✅ Google Drive v3 confirmado (Sync Tempo Real + Link Direto PDF + Exclusão Completa ADM)!")
                return script_url
            elif ok and info.get("syncDatabaseReady") is True:
                reason = "O Google Apps Script está na Versão 2 e precisa ser atualizado p/ Versão 3 (habilita o ADM a apagar PDFs e registros direto do Google Drive)."
            elif ok:
                reason = "O script no Google Drive respondeu, mas ainda está na Versão 1 (anterior à sincronização em tempo real e exclusão no Drive)."
            else:
                reason = f"Não foi possível validar a URL atual ({info.get('error', 'resposta inválida')})."
        else:
            reason = "Nenhuma URL do Google Apps Script configurada."

        if not interactive:
            print(f"⚠️ AVISO Google Drive: {reason}")
            return script_url

        gs_path = os.path.join(ROOT_DIR, "google-drive-integracao", "Codigo_Google_Apps_Script.gs")
        print("\n" + "=" * 74)
        print(" ☁️ ATUALIZAÇÃO RÁPIDA DO GOOGLE APPS SCRIPT NECESSÁRIA (LEVA 1 MINUTO)")
        print("=" * 74)
        print(f" Motivo: {reason}\n")
        print(" Faça estes 3 passos no navegador antes de continuar:")
        print(f"  1. Abra e copie todo o arquivo:\n     {gs_path}")
        print("  2. No Google Apps Script (https://script.google.com), cole substituindo o código antigo e salve (Ctrl+S).")
        print("  3. Clique em 'Implantar' -> 'Gerenciar implantações' -> ícone Lápis (Editar)")
        print("     -> em Versão escolha 'Nova versão' -> clique em 'Implantar'.")
        print("=" * 74)
        try:
            ans = input("\n👉 Aperte ENTER após clicar em Implantar (ou cole uma nova URL /exec, ou digite 'pular'): ").strip()
        except EOFError:
            return script_url

        if ans.lower() in ("pular", "skip", "sair", "n"):
            print("⚠️ Continuando sem validar a versão v2 do Apps Script (lembre-se de atualizar no navegador!).")
            return script_url
        clean_ans = ans.strip().strip('"').strip("'")
        if "https://script.google.com/" in clean_ans:
            m_url = re.search(r"https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec", clean_ans)
            script_url = m_url.group(0) if m_url else clean_ans
            write_embedded_drive_url(script_url)
        else:
            # Recarrega do arquivo storage.js caso tenha sido atualizado em disco
            latest_disk_url = read_embedded_drive_url()
            if latest_disk_url:
                script_url = latest_disk_url


def migrate_github_db_to_drive_if_exists(token, drive_url):
    st_db, remote_db_meta = gh_api("GET", f"/repos/{OWNER}/{REPO}/contents/base_dados_samu.json?ref={BRANCH}", token)
    if st_db != 200 or not isinstance(remote_db_meta, dict) or not remote_db_meta.get("content"):
        return False

    print("🔄 Encontrada base anterior 'base_dados_samu.json' no GitHub -> migrando dados p/ Google Drive antes de remover do GitHub...")
    try:
        raw_json = base64.b64decode(remote_db_meta["content"]).decode("utf-8")
        remote_db = json.loads(raw_json)
        if drive_url and isinstance(remote_db, dict):
            ok, res = post_drive_script(drive_url, {
                "action": "syncDatabase",
                "pushChanges": True,
                "clientDb": remote_db,
            })
            if ok:
                users_cnt = len((res.get("db") or {}).get("users") or [])
                print(f"✅ Dados migrados com segurança para o Google Drive ({users_cnt} usuários preservados)!")
            else:
                print(f"⚠️ Aviso ao migrar dados para o Google Drive: {res.get('error', res)}")
    except Exception as exc:
        print(f"⚠️ Aviso ao decodificar base_dados_samu.json anterior: {exc}")

    return True


def bump_semver_patch(ver_str):
    parts = str(ver_str or "1.0.0").strip().split(".")
    while len(parts) < 3:
        parts.append("0")
    try:
        parts[2] = str(int(parts[2]) + 1)
    except ValueError:
        parts[2] = "1"
    return ".".join(parts[:3])


def sync_local_assets_www():
    src_web = os.path.join(ROOT_DIR, "web-app")
    dst_www = os.path.join(ROOT_DIR, "android-project", "app", "src", "main", "assets", "www")
    if os.path.exists(dst_www):
        shutil.rmtree(dst_www)
    shutil.copytree(src_web, dst_www)
    if os.path.exists(VERSION_FILE):
        shutil.copy2(VERSION_FILE, os.path.join(dst_www, "version.json"))


def collect_repo_files(include_workflows=True):
    collected = {}

    for rf in INCLUDE_ROOT_FILES:
        if rf in EXCLUDE_NAMES:
            continue
        full = os.path.join(ROOT_DIR, rf)
        if os.path.isfile(full):
            collected[rf] = full

    for d in INCLUDE_DIRS:
        if d == ".github" and not include_workflows:
            continue
        base_d = os.path.join(ROOT_DIR, d)
        if not os.path.isdir(base_d):
            continue
        for root, dirs, files in os.walk(base_d):
            dirs[:] = [x for x in dirs if x not in EXCLUDE_NAMES and not x.endswith(".local")]
            for fn in files:
                if (
                    fn in EXCLUDE_NAMES
                    or fn.endswith(".local")
                    or fn.endswith(".token")
                    or fn.endswith(".pyc")
                    or fn.endswith(".jks")
                    or fn.endswith(".keystore")
                ):
                    continue
                full_p = os.path.join(root, fn)
                rel_p = os.path.relpath(full_p, ROOT_DIR).replace("\\", "/")
                collected[rel_p] = full_p

    return collected


def resolve_token(cli_token):
    tok = (cli_token or os.environ.get("GITHUB_TOKEN") or "").strip()
    if not tok and os.path.isfile(TOKEN_FILE):
        with open(TOKEN_FILE, "r", encoding="utf-8") as f:
            tok = f.read().strip()
    if not tok:
        print("=" * 68)
        print(f" CONECTAR AO REPOSITÓRIO DE PUBLICAÇÃO: https://github.com/{OWNER}/{REPO}")
        print(" (Usado apenas neste PC para publicar atualizações; os celulares NÃO precisam de token!)")
        print("=" * 68)
        tok = input("Cole aqui o seu Token do GitHub (ghp_... ou github_pat_...): ").strip()
    if not tok:
        print("ERRO: Nenhum token informado.")
        sys.exit(1)
    with open(TOKEN_FILE, "w", encoding="utf-8") as f:
        f.write(tok)
    return tok


def upload_release_asset(upload_url_template, token, file_path, content_type):
    base_upload_url = upload_url_template.split("{")[0]
    fname = os.path.basename(file_path)
    full_url = f"{base_upload_url}?name={urllib.parse.quote(fname)}"
    with open(file_path, "rb") as f:
        raw_bytes = f.read()
    req = urllib.request.Request(full_url, data=raw_bytes, method="POST")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "SAMU192-Orlandia-Publisher/2.0")
    req.add_header("Content-Type", content_type)
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read().decode("utf-8"))


def publish_github_release(token, local_ver, local_apk_path):
    ver_name = local_ver.get("apkVersionName", "1.0.0")
    ver_code = local_ver.get("apkVersionCode", 1)
    ota_rev = local_ver.get("otaRevision", 1)
    notes = local_ver.get("releaseNotes", "Atualização oficial SAMU 192 Orlândia-SP")
    tag = f"v{ver_name}-b{ver_code}-r{ota_rev}"

    print(f"\nPublicando Release oficial {tag} com instalador SAMU_192_Orlandia.apk...")
    st_r, rel_obj = gh_api("GET", f"/repos/{OWNER}/{REPO}/releases/tags/{tag}", token)
    if st_r == 404:
        st_r, rel_obj = gh_api("POST", f"/repos/{OWNER}/{REPO}/releases", token, {
            "tag_name": tag,
            "target_commitish": BRANCH,
            "name": f"SAMU 192 Orlândia v{ver_name} (Build {ver_code} • Rev #{ota_rev})",
            "body": notes,
            "draft": False,
            "prerelease": False,
            "make_latest": "true"
        })
    if st_r >= 400 or not rel_obj.get("upload_url"):
        print(f"AVISO: Não foi possível criar Release HTTP {st_r}:", rel_obj)
        return

    for asset in rel_obj.get("assets", []) or []:
        if asset.get("name") in ("SAMU_192_Orlandia.apk", "version.json"):
            gh_api("DELETE", f"/repos/{OWNER}/{REPO}/releases/assets/{asset['id']}", token)

    upload_url_tpl = rel_obj["upload_url"]
    apk_asset = upload_release_asset(upload_url_tpl, token, local_apk_path, "application/vnd.android.package-archive")
    upload_release_asset(upload_url_tpl, token, VERSION_FILE, "application/json")
    print(f"✅ APK publicado na Release! Download público: https://github.com/{OWNER}/{REPO}/releases/latest/download/SAMU_192_Orlandia.apk")
    print(f"   Página da Release: {rel_obj.get('html_url')} (Asset ID: {apk_asset.get('id')})")


def load_local_builder_module():
    builder_path = os.path.join(ROOT_DIR, "android-project", "build_apk_ci.py")
    if not os.path.isfile(builder_path):
        return None
    spec = importlib.util.spec_from_file_location("samu_build_apk_ci", builder_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def ensure_local_keystore_ready(token):
    """
    Garante que o certificado fixo samu_orlandia_release.jks exista APENAS localmente neste PC
    (nunca sobe .jks para o GitHub público!). Se havia um .jks anterior no GitHub privado,
    resgata-o localmente antes da limpeza do histórico para manter a mesma assinatura Android
    nos celulares que já instalaram a versão anterior.
    """
    ks_local = os.path.join(ROOT_DIR, "android-project", "samu_orlandia_release.jks")
    ks_repo_path = "android-project/samu_orlandia_release.jks"
    st_ks, ks_meta = gh_api("GET", f"/repos/{OWNER}/{REPO}/contents/{ks_repo_path}?ref={BRANCH}", token)
    ks_was_on_github = (st_ks == 200)

    if not os.path.isfile(ks_local):
        if ks_was_on_github and isinstance(ks_meta, dict) and ks_meta.get("content"):
            print("🔑 Resgatando certificado samu_orlandia_release.jks para este PC (mantém compatibilidade de atualização nos celulares)...")
            raw_ks = base64.b64decode(ks_meta["content"])
            os.makedirs(os.path.dirname(ks_local), exist_ok=True)
            with open(ks_local, "wb") as kf:
                kf.write(raw_ks)
        else:
            try:
                bmod = load_local_builder_module()
                if bmod and hasattr(bmod, "ensure_keystore_exists"):
                    print("🔑 Gerando certificado local samu_orlandia_release.jks neste PC...")
                    bmod.ensure_keystore_exists()
            except Exception:
                pass

    return ks_was_on_github


def download_latest_release_apk(token, dest_apk_path):
    st_rel, rel_meta = gh_api("GET", f"/repos/{OWNER}/{REPO}/releases/latest", token)
    if st_rel >= 400 or not isinstance(rel_meta, dict):
        print(f"⚠️ Não foi possível consultar a última Release (HTTP {st_rel}).")
        return False

    apk_asset = None
    for asset in rel_meta.get("assets", []) or []:
        if str(asset.get("name", "")).lower().endswith(".apk"):
            apk_asset = asset
            break

    if not apk_asset or not apk_asset.get("url"):
        print("⚠️ Release encontrada, mas o arquivo .apk ainda não consta nos assets.")
        return False

    asset_api_url = apk_asset["url"]
    print(f"📥 Baixando APK compilado da Release ({rel_meta.get('tag_name', 'latest')}) para esta pasta...")
    req = urllib.request.Request(asset_api_url, method="GET")
    req.add_header("Accept", "application/octet-stream")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "SAMU192-Orlandia-Publisher/2.0")
    req.add_unredirected_header("Authorization", f"Bearer {token}")

    with urllib.request.urlopen(req, timeout=180) as resp:
        apk_bytes = resp.read()

    with open(dest_apk_path, "wb") as out_f:
        out_f.write(apk_bytes)

    size_mb = len(apk_bytes) / (1024 * 1024)
    print(f"✅ APK salvo com sucesso no seu PC: {dest_apk_path} ({size_mb:.2f} MB)")
    return True


def trigger_and_monitor_cloud_compile(token, expected_head_sha=""):
    wf_path = ".github/workflows/build-apk.yml"
    st_wf, _ = gh_api("GET", f"/repos/{OWNER}/{REPO}/contents/{wf_path}?ref={BRANCH}", token)
    if st_wf == 404:
        print("\n⚠️ O workflow de compilação na nuvem (.github/workflows/build-apk.yml) ainda não está no GitHub")
        print("   porque o Token atual não tem a permissão 'workflow' marcada (e o Android SDK local não foi detectado neste PC).")
        return False

    print("\n☁️ Verificando / iniciando compilação do APK no GitHub Actions...")
    if expected_head_sha:
        time.sleep(4)

    target_run = None
    st_runs, runs_data = gh_api(
        "GET",
        f"/repos/{OWNER}/{REPO}/actions/workflows/build-apk.yml/runs?branch={BRANCH}&per_page=5",
        token
    )
    if st_runs == 200 and isinstance(runs_data, dict):
        for r in runs_data.get("workflow_runs", []) or []:
            r_status = r.get("status")
            r_sha = r.get("head_sha", "")
            if (expected_head_sha and r_sha == expected_head_sha) or r_status in ("queued", "in_progress", "waiting", "requested"):
                target_run = r
                break

    if not target_run:
        print("🚀 Disparando compilação imediata no GitHub Actions (workflow_dispatch)...")
        st_disp, disp_err = gh_api(
            "POST",
            f"/repos/{OWNER}/{REPO}/actions/workflows/build-apk.yml/dispatches",
            token,
            {"ref": BRANCH}
        )
        if st_disp not in (200, 201, 204):
            print(f"⚠️ Falha HTTP {st_disp} ao disparar GitHub Actions:", disp_err)
            return False

        for _ in range(8):
            time.sleep(3)
            st_r2, runs_d2 = gh_api(
                "GET",
                f"/repos/{OWNER}/{REPO}/actions/workflows/build-apk.yml/runs?branch={BRANCH}&per_page=3",
                token
            )
            if st_r2 == 200 and isinstance(runs_d2, dict):
                w_runs = runs_d2.get("workflow_runs", []) or []
                if w_runs:
                    target_run = w_runs[0]
                    if target_run.get("status") in ("queued", "in_progress", "waiting", "requested") or (
                        expected_head_sha and target_run.get("head_sha") == expected_head_sha
                    ):
                        break

    if not target_run or not target_run.get("id"):
        print(f"✅ Compilação solicitada! Acompanhe em: https://github.com/{OWNER}/{REPO}/actions")
        return True

    run_id = target_run["id"]
    run_url = target_run.get("html_url") or f"https://github.com/{OWNER}/{REPO}/actions/runs/{run_id}"
    print(f"🔗 Compilação em andamento no GitHub: {run_url}")

    start_ts = time.time()
    last_line = ""
    while time.time() - start_ts < 900:
        st_cur, cur_run = gh_api("GET", f"/repos/{OWNER}/{REPO}/actions/runs/{run_id}", token)
        if st_cur >= 400:
            break
        status = cur_run.get("status", "")
        conclusion = cur_run.get("conclusion")
        elapsed = int(time.time() - start_ts)

        step_label = status
        if status == "in_progress":
            st_j, jobs_obj = gh_api("GET", f"/repos/{OWNER}/{REPO}/actions/runs/{run_id}/jobs", token)
            if st_j == 200 and isinstance(jobs_obj, dict):
                for jb in jobs_obj.get("jobs", []) or []:
                    for stp in jb.get("steps", []) or []:
                        if stp.get("status") == "in_progress":
                            step_label = f"em andamento -> {stp.get('name')}"
                            break

        line = f"   ⏳ [{elapsed:>3}s] Status da compilação: {step_label}"
        if line != last_line:
            print(line)
            last_line = line

        if status == "completed":
            if conclusion == "success":
                print("\n🎉 Compilação concluída com SUCESSO no GitHub Actions!")
                dest_apk = os.path.join(ROOT_DIR, "SAMU_192_Orlandia.apk")
                time.sleep(2)
                download_latest_release_apk(token, dest_apk)
                return True
            else:
                print(f"\n❌ A compilação no GitHub terminou com status '{conclusion}'.")
                print(f"   Veja o log detalhado em: {run_url}")
                return False

        time.sleep(8)

    print(f"\n⚠️ Tempo limite de acompanhamento atingido. Confira o resultado em: {run_url}")
    return False


def start_apk_compilation(token, local_ver, expected_head_sha="", force_cloud=False):
    print("\n" + "=" * 72)
    print(" 🔨 INICIANDO COMPILAÇÃO DO INSTALADOR SAMU_192_Orlandia.apk")
    print("=" * 72)

    builder_mod = None if force_cloud else load_local_builder_module()
    can_local = bool(builder_mod and hasattr(builder_mod, "has_local_build_environment") and builder_mod.has_local_build_environment())

    if can_local:
        print("💻 Ambiente Java + Android SDK detectado neste PC! Compilando localmente (assinatura oficial preservada)...")
        try:
            ensure_local_keystore_ready(token)
            builder_mod.main()
            local_apk_path = os.path.join(ROOT_DIR, "SAMU_192_Orlandia.apk")
            if os.path.isfile(local_apk_path) and os.path.getsize(local_apk_path) > 50000:
                publish_github_release(token, local_ver, local_apk_path)
                return True
        except Exception as exc:
            print(f"⚠️ Falha na compilação local ({exc}). Tentando compilação na nuvem (GitHub Actions)...")

    return trigger_and_monitor_cloud_compile(token, expected_head_sha=expected_head_sha)


def main():
    parser = argparse.ArgumentParser(description="Publicar SAMU 192 Orlândia (Auto-Update Público + Sync Google Drive)")
    parser.add_argument("--token", default="", help="Personal Access Token do GitHub (usado apenas neste PC)")
    parser.add_argument("--novo-apk", action="store_true", help="Incrementa apkVersionCode para compilar novo .APK e forçar auto-update do APK")
    parser.add_argument("--manter-versao", action="store_true", help="Mantém apkVersionCode e otaRevision atuais")
    parser.add_argument("--compilar", action="store_true", help="Já inicia a compilação do .APK logo após publicar a atualização")
    parser.add_argument("--compilar-nuvem", action="store_true", help="Força compilação do .APK via GitHub Actions na nuvem após atualizar")
    parser.add_argument("--apenas-compilar", action="store_true", help="Apenas inicia a compilação do .APK da versão atual sem subir novo commit")
    parser.add_argument("--perguntar-compilar", action="store_true", help="Pergunta ao final da atualização se já deseja iniciar a compilação do .APK")
    parser.add_argument("--subir-apk-local", action="store_true", help="Publica na Release um SAMU_192_Orlandia.apk já existente na pasta")
    parser.add_argument("--nao-interativo", action="store_true", help="Não pausa pedindo confirmação interativa")
    parser.add_argument("--notas", default="", help="Descrição desta atualização")
    args = parser.parse_args()

    token = resolve_token(args.token)

    # 1. Verifica acesso ao repositório no GitHub
    st, repo_info, resp_hdrs = gh_api("GET", f"/repos/{OWNER}/{REPO}", token, return_headers=True)
    if st == 401:
        print("ERRO 401: Token inválido ou expirado.")
        sys.exit(2)
    if st == 404:
        print(f"ERRO 404: O repositório {OWNER}/{REPO} não foi encontrado ou este token não tem acesso a ele.")
        sys.exit(3)
    if st >= 400:
        print(f"ERRO HTTP {st} ao acessar repositório:", repo_info)
        sys.exit(3)

    oauth_scopes = ""
    for hk, hv in resp_hdrs.items():
        if hk.lower() == "x-oauth-scopes":
            oauth_scopes = hv
            break
    is_repo_private = bool(repo_info.get("private"))
    print(f"Conectado a: https://github.com/{OWNER}/{REPO} (privado={is_repo_private}, escopos='{oauth_scopes}')")

    # 2. Valida e embute a URL do Google Apps Script v2 no APK antes de sincronizar assets
    drive_url = verify_and_embed_drive_script_url(interactive=not args.nao_interativo)

    # 3. Verifica branch main no GitHub
    st_ref, ref_info = gh_api("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}", token)
    readme_txt = (
        "# SAMU 192 – Orlândia-SP (Canal Oficial de Auto-Update do APK)\n\n"
        "Este repositório distribui exclusivamente as atualizações automáticas de código/interface (Live OTA) "
        "e o instalador `SAMU_192_Orlandia.apk` para os aparelhos das viaturas.\n\n"
        "- **Privacidade Total (LGPD):** Nenhum dado de paciente, CPF, ficha, PDF ou senha é armazenado neste repositório. "
        "Toda a sincronização operacional ocorre de forma privada no Google Drive oficial da Central SAMU.\n"
    )
    if st_ref in (404, 409):
        print("Repositório vazio detectado! Inicializando branch main...")
        st_init, init_res = gh_api("PUT", f"/repos/{OWNER}/{REPO}/contents/README.md", token, {
            "message": "chore: inicializar canal de auto-update SAMU 192 Orlandia-SP",
            "content": base64.b64encode(readme_txt.encode("utf-8")).decode("ascii"),
            "branch": BRANCH
        })
        if st_init >= 400:
            print(f"ERRO HTTP {st_init} ao inicializar repositório:", init_res)
            sys.exit(4)
        st_ref, ref_info = gh_api("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}", token)

    if st_ref >= 400:
        print(f"ERRO HTTP {st_ref} ao ler branch {BRANCH}:", ref_info)
        sys.exit(4)

    head_commit_sha = ref_info["object"]["sha"]

    # 4. Resgata chave local .jks (se estava no GitHub) e migra base_dados_samu.json p/ Google Drive antes de limpar histórico
    ks_was_on_github = ensure_local_keystore_ready(token)
    db_was_on_github = migrate_github_db_to_drive_if_exists(token, drive_url)

    # 5. Lê version.json remoto e atualiza versão local
    st_ver, remote_ver_meta = gh_api("GET", f"/repos/{OWNER}/{REPO}/contents/version.json?ref={BRANCH}", token)
    remote_ver = None
    if st_ver == 200 and remote_ver_meta.get("content"):
        try:
            raw_v = base64.b64decode(remote_ver_meta["content"]).decode("utf-8")
            remote_ver = json.loads(raw_v)
        except Exception:
            remote_ver = None

    with open(VERSION_FILE, "r", encoding="utf-8") as vf:
        local_ver = json.load(vf)

    if args.apenas_compilar:
        sync_local_assets_www()
        start_apk_compilation(
            token,
            local_ver,
            expected_head_sha=head_commit_sha,
            force_cloud=args.compilar_nuvem
        )
        return

    now_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if remote_ver is not None and not args.manter_versao:
        next_ota = max(int(local_ver.get("otaRevision", 1)), int(remote_ver.get("otaRevision", 1))) + 1
        cur_code = max(int(local_ver.get("apkVersionCode", 1)), int(remote_ver.get("apkVersionCode", 1)))
        cur_name = str(remote_ver.get("apkVersionName") or local_ver.get("apkVersionName") or "1.0.0")
        if args.novo_apk:
            local_ver["apkVersionCode"] = cur_code + 1
            local_ver["apkVersionName"] = bump_semver_patch(cur_name)
        else:
            local_ver["apkVersionCode"] = cur_code
            local_ver["apkVersionName"] = cur_name
        local_ver["otaRevision"] = next_ota
    else:
        local_ver["apkVersionCode"] = int(local_ver.get("apkVersionCode", 1))
        local_ver["apkVersionName"] = str(local_ver.get("apkVersionName", "1.0.0"))
        local_ver["otaRevision"] = int(local_ver.get("otaRevision", 1))

    local_ver["updatedAt"] = now_iso
    local_ver["repo"] = f"{OWNER}/{REPO}"
    local_ver["branch"] = BRANCH
    local_ver["apkDownloadUrl"] = f"https://github.com/{OWNER}/{REPO}/releases/latest/download/SAMU_192_Orlandia.apk"
    if args.notas:
        local_ver["releaseNotes"] = args.notas
    elif not local_ver.get("releaseNotes"):
        local_ver["releaseNotes"] = "Sincronização automática Google Drive + Auto-Update sem token"

    with open(VERSION_FILE, "w", encoding="utf-8") as vf:
        json.dump(local_ver, vf, indent=2, ensure_ascii=False)

    # Sincroniza assets/www com o web-app (já contendo DEFAULT_SCRIPT_URL) + version.json atualizados
    sync_local_assets_www()

    # Sempre cria árvore limpa (sem base_tree) para nunca sobrar base_dados_samu.json ou .jks no repositório;
    # se o repositório era privado ou continha base_dados_samu.json/.jks, cria commit raiz sem parentes (limpa histórico!).
    purge_git_history = bool(is_repo_private or db_was_on_github or ks_was_on_github)
    if purge_git_history:
        print("🧹 Limpando histórico antigo do GitHub (removendo qualquer rastro de base_dados_samu.json e certificado .jks)...")

    def push_tree(include_workflows):
        files_map = collect_repo_files(include_workflows=include_workflows)
        print(f"Enviando {len(files_map)} arquivos de código do aplicativo para {OWNER}/{REPO}...")
        tree_items = []

        # Inclui README.md limpo na raiz da árvore
        st_rb, rb_res = gh_api("POST", f"/repos/{OWNER}/{REPO}/git/blobs", token, {
            "content": base64.b64encode(readme_txt.encode("utf-8")).decode("ascii"),
            "encoding": "base64"
        })
        if st_rb < 400 and rb_res.get("sha"):
            tree_items.append({
                "path": "README.md",
                "mode": "100644",
                "type": "blob",
                "sha": rb_res["sha"]
            })

        for rel_path, disk_path in sorted(files_map.items()):
            with open(disk_path, "rb") as bf:
                raw_bytes = bf.read()
            b64_str = base64.b64encode(raw_bytes).decode("ascii")
            st_b, blob_res = gh_api("POST", f"/repos/{OWNER}/{REPO}/git/blobs", token, {
                "content": b64_str,
                "encoding": "base64"
            })
            if st_b >= 400:
                return st_b, blob_res, ""
            tree_items.append({
                "path": rel_path,
                "mode": "100644",
                "type": "blob",
                "sha": blob_res["sha"]
            })

        # Sem base_tree -> garante que somente os arquivos permitidos existam na árvore publicada
        st_t, tree_res = gh_api("POST", f"/repos/{OWNER}/{REPO}/git/trees", token, {
            "tree": tree_items
        })
        if st_t >= 400:
            return st_t, tree_res, ""

        msg = (
            f"release: SAMU 192 v{local_ver['apkVersionName']} "
            f"(build {local_ver['apkVersionCode']} • ota #{local_ver['otaRevision']})"
        )
        if args.notas:
            msg += f" - {args.notas}"

        parents_list = [] if purge_git_history else [head_commit_sha]
        st_c, new_commit = gh_api("POST", f"/repos/{OWNER}/{REPO}/git/commits", token, {
            "message": msg,
            "tree": tree_res["sha"],
            "parents": parents_list
        })
        if st_c >= 400:
            return st_c, new_commit, ""

        st_u, upd_res = gh_api("PATCH", f"/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}", token, {
            "sha": new_commit["sha"],
            "force": bool(purge_git_history)
        })
        return st_u, upd_res, new_commit["sha"]

    has_workflow_scope = (not oauth_scopes) or ("workflow" in oauth_scopes.lower())
    st_push, push_res, pushed_sha = push_tree(include_workflows=has_workflow_scope)
    if has_workflow_scope and st_push in (403, 404, 422):
        print(f"\nAVISO (HTTP {st_push} ao incluir workflow): enviando sem '.github/workflows/build-apk.yml'...")
        has_workflow_scope = False
        st_push, push_res, pushed_sha = push_tree(include_workflows=False)

    if st_push >= 400:
        print(f"ERRO HTTP {st_push} ao publicar commit:", push_res)
        sys.exit(5)

    # 6. Agora que o repositório contém APENAS o código do app (zero dados sensíveis), garante que seja PÚBLICO
    #    para que 100% dos celulares façam Auto-Update (OTA e APK) sem precisar de nenhum Token!
    if is_repo_private:
        print("🌐 Liberando visibilidade PÚBLICA do canal de Auto-Update (zero dados de pacientes no GitHub)...")
        st_pub, pub_res = gh_api("PATCH", f"/repos/{OWNER}/{REPO}", token, {"private": False})
        if st_pub == 200 and pub_res.get("private") is False:
            print("✅ Repositório configurado como PÚBLICO com sucesso! Todos os celulares atualizam sozinhos SEM TOKEN!")
        else:
            print(f"⚠️ Aviso HTTP {st_pub} ao tornar repositório público automaticamente: {pub_res.get('message', pub_res)}")
            print(f"   Caso necessário, abra https://github.com/{OWNER}/{REPO}/settings -> Danger Zone -> Change visibility -> Make public.")

    print("\n" + "=" * 72)
    print(f"✅ ATUALIZAÇÃO PUBLICADA COM SUCESSO EM https://github.com/{OWNER}/{REPO} !")
    print(f"   Versão APK : v{local_ver['apkVersionName']} (versionCode {local_ver['apkVersionCode']})")
    print(f"   Revisão OTA: #{local_ver['otaRevision']} (os celulares atualizam sozinhos SEM TOKEN!)")
    print(f"   Sync Dados : Google Drive em Tempo Real (pré-configurado de fábrica no APK)")
    print(f"   Download   : https://github.com/{OWNER}/{REPO}/releases/latest")
    print("=" * 72)

    should_compile = bool(args.compilar or args.compilar_nuvem)
    if not should_compile and args.perguntar_compilar and not args.nao_interativo:
        try:
            ans = input("\n👉 Deseja já iniciar a compilação do SAMU_192_Orlandia.apk agora? (S/N, Enter = N): ").strip().lower()
            if ans in ("s", "sim", "y", "yes", "1"):
                should_compile = True
        except EOFError:
            pass

    if should_compile:
        start_apk_compilation(
            token,
            local_ver,
            expected_head_sha=pushed_sha,
            force_cloud=args.compilar_nuvem
        )
    elif args.subir_apk_local:
        local_apk_path = os.path.join(ROOT_DIR, "SAMU_192_Orlandia.apk")
        if os.path.isfile(local_apk_path) and os.path.getsize(local_apk_path) > 50000:
            publish_github_release(token, local_ver, local_apk_path)


if __name__ == "__main__":
    main()
