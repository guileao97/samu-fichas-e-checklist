# Como Conectar e Atualizar o Google Drive da Base (SAMU 192 – Orlândia-SP)

Esta integração é **100% gratuita**, usa a própria conta Google oficial do SAMU e **não exige Token do GitHub nem senha da conta Google da base** nos celulares dos condutores, técnicos e enfermeiros.

O **Google Drive / Google Apps Script** cuida automaticamente de:
1. **Sincronização em Tempo Real entre Celulares** (`base_dados_samu_drive.json` + Cache RAM): logins, solicitações de cadastro, aprovações, cargos híbridos (`Condutor + ADM`, `Enfermeiro + ADM`, `Téc. + ADM`), exclusão definitiva de logins, equipes do plantão, **Ficha de Atendimento compartilhada em tempo real**, rascunhos da equipe, avarias persistentes da viatura, recebedores de hospital, médicos reguladores e pacientes por CPF.
2. **Organização Automática dos PDFs** em pastas por Tipo e Mês (`AAAA-MM`) + **Planilha Google de Controle**.
3. **Visualização Direta do PDF no Celular**: cada PDF enviado recebe permissão individual de visualização por link (*Qualquer pessoa com o link -> Leitor*), permitindo abrir o botão **`☁️ Ver no Google Drive`** direto do celular sem pedir permissão de acesso, enquanto **todas as pastas e a Planilha de Controle permanecem 100% privadas** na conta Google do SAMU!

---

## Como Atualizar o Script no Google Apps Script (quando houver melhoria no `Codigo_Google_Apps_Script.gs`)

> **Atalho em 1 clique no Windows:** dê dois cliques em [`ATUALIZAR_GOOGLE_APPS_SCRIPT.bat`](./ATUALIZAR_GOOGLE_APPS_SCRIPT.bat) — ele já copia todo o código `v4` automaticamente para o seu `Ctrl + V` e abre o painel `https://script.google.com`!

1. Acesse **https://script.google.com** na conta Google da base e abra o projeto **`SAMU 192 Orlandia`**.
2. Clique dentro do editor, pressione **`Ctrl + A`** e depois **`Ctrl + V`** (para colar todo o conteúdo de [`Codigo_Google_Apps_Script.gs`](./Codigo_Google_Apps_Script.gs)).
3. Pressione **`Ctrl + S`** (Salvar).
4. No canto superior direito, clique em **Implantar** -> **Gerenciar implantações**.
5. Clique no ícone de **Lápis (`✏️` Editar)**, em **Versão** selecione **`Nova versão`** e clique em **Implantar** (isso mantém exatamente a mesma URL `/exec` já gravada de fábrica no APK e no PC da Base!).

---

## Primeira Criação (caso crie em outra conta Google no futuro)

1. Acesse **https://script.google.com** e clique em **Novo projeto**.
2. Cole todo o conteúdo de [`Codigo_Google_Apps_Script.gs`](./Codigo_Google_Apps_Script.gs) e salve (`SAMU 192 Orlandia`).
3. Clique em **Implantar** -> **Nova implantação** -> tipo **App da Web**:
   - **Executar como:** `Eu`
   - **Quem pode acessar:** `Qualquer pessoa`
4. Autorize as permissões (*Avançado -> Acessar -> Permitir*) e copie a URL `/exec`.
5. O APK já traz a URL oficial do SAMU Orlândia configurada de fábrica; caso mude de conta Google no futuro, basta colar a nova URL na aba **⚙️ Base/Drive** ou durante o `PUBLICAR_ATUALIZACAO_GITHUB.bat`.

---

## Estrutura Criada Automaticamente no Google Drive (Não precisa criar pastas manualmente)

- 📁 `SAMU 192 Orlândia - Sistema Digital` *(pasta raiz privada da conta SAMU)*
  - 📁 `Fichas de Atendimento` -> subpastas automáticas por mês (`2026-10`, `2026-11`, ...)
  - 📁 `Check List - Condutor Socorrista` -> subpastas automáticas por mês (`2026-10`, `2026-11`, ...)
  - 📁 `Check List - Enfermagem` -> subpastas automáticas por mês (`2026-10`, `2026-11`, ...)
  - 🗄️ `base_dados_samu_drive.json` *(banco sincronizado em tempo real entre os celulares)*
  - 📊 `SAMU 192 Orlândia - Controle e Histórico` *(Planilha Google privada com abas `Usuarios` e `Registros`)*
