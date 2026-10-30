# Compilação Automática do APK + Auto-Update + Base Offline/Online no GitHub

Repositório oficial pré-configurado no aplicativo:
👉 **`https://github.com/guileao97/samu-fichas-e-checklist`** (`guileao97/samu-fichas-e-checklist`)

---

## 1. Posso usar o mesmo Token do GitHub criado para outro aplicativo?

**Sim, pode usar o mesmo token!** Basta conferir qual tipo de token você criou:

- **Token Clássico (`ghp_...`)**:
  - Funciona em todos os seus repositórios automaticamente.
  - Precisa ter as permissões **`repo`** (para gravar código, releases e `base_dados_samu.json`) e **`workflow`** (exigida pelo GitHub para subir o compilador automático `.github/workflows/build-apk.yml`).
- **Token Fine-Grained (`github_pat_...`)**:
  - Se foi criado marcado como **All repositories**, já funciona direto em `samu-fichas-e-checklist`. *(Se foi criado restrito a apenas 1 repositório antigo, basta abrir **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**, clicar em Edit e incluir `samu-fichas-e-checklist`)*.
  - Permissões do repositório: **Contents: Read and write** e **Workflows: Read and write** *(Metadata: Read-only já vem marcado)*.

> **Segurança:** Nunca cole o token dentro do código-fonte. O script `PUBLICAR_NO_GITHUB.py` salva o token apenas no seu computador no arquivo oculto `.github_token.local` (ignorado pelo envio para que o GitHub nunca bloqueie/revogue seu token), e nos celulares o token fica salvo apenas no banco `SQLite` interno do aparelho.

---

## 2. Como Subir Tudo para o GitHub e Compilar o `SAMU_192_Orlandia.apk`

Como o Windows não precisa ter o `git` instalado, deixamos um publicador direto em Python pronto na pasta:

1. Dê **2 cliques** em **`PUBLICAR_ATUALIZACAO_GITHUB.bat`** (que executa `PUBLICAR_NO_GITHUB.py`).
2. Na primeira vez, cole o seu **Token do GitHub** quando solicitado no terminal.
3. O script envia todo o projeto para `guileao97/samu-fichas-e-checklist` (preservando `base_dados_samu.json` caso já exista lá para nunca apagar cadastros da equipe).
4. Automaticamente, a aba **Actions** do GitHub (`https://github.com/guileao97/samu-fichas-e-checklist/actions`) compila e assina o instalador **`SAMU_192_Orlandia.apk`** (leva ~2 minutos) e publica na aba **Releases**:
   - Link direto sempre atualizado do APK:
     `https://github.com/guileao97/samu-fichas-e-checklist/releases/latest/download/SAMU_192_Orlandia.apk`

---

## 3. Como Funciona a Atualização Automática nos Celulares (Auto-Update Duplo)

Depois que o `SAMU_192_Orlandia.apk` estiver instalado nos celulares/tablets das ambulâncias:

1. **Atualização Instantânea Silenciosa (Live OTA — sem precisar reinstalar APK)**:
   - Sempre que alterarmos campos da ficha, listas de medicamentos, layout do PDF ou regras de tela e rodarmos `PUBLICAR_ATUALIZACAO_GITHUB.bat`, a revisão `otaRevision` do arquivo `version.json` sobe automaticamente.
   - Assim que o celular conectar no Wi-Fi ou 4G, o APK detecta a nova versão no GitHub, baixa os arquivos internamente para a memória nativa (`ota_www`) e mostra a faixa verde no topo (**"Atualização pronta — Toque em Aplicar Agora"**), atualizando na hora sem abrir tela de instalador e sem perder nenhum rascunho ou ficha offline!
2. **Atualização Completa do Instalador Nativo (`.apk`)**:
   - Quando houver mudança na camada nativa Android/Java (rodando `python PUBLICAR_NO_GITHUB.py --novo-apk`), o GitHub Actions gera uma nova Release com `apkVersionCode` maior.
   - Os celulares mostram o botão **"📲 Baixar e Atualizar APK"** com porcentagem em tempo real (`0% ... 100%`) e já abrem o instalador nativo do Android automaticamente com a mesma assinatura digital (atualiza por cima mantendo todo o banco `SQLite`).

---

## 4. Base de Dados Sincronizada (`base_dados_samu.json`) + Banco `SQLite` Offline

Mesmo quando a ambulância estiver **sem sinal nenhum**, tudo funciona pelo banco nativo **`SamuSqliteDb` (`samu_orlandia_192.db`)**. Quando houver internet (e o token estiver salvo na engrenagem **⚙️ Base/GitHub**), o APK sincroniza com `base_dados_samu.json`:
- **Cadastros e Aprovações de Equipe (`users`)**: novos cadastros criados na tela inicial e aprovados pelo Adm na aba `✅ Aprovar`.
- **Recebedores do Hospital (`hospitalReceivers`)**: Nome e COREN/CRM de quem recebe no **HBSA** (ou outro destino) salvos para apenas assinar nas próximas fichas.
- **Pacientes (`patients`)**: autopreenchimento rápido por CPF mesmo offline.
