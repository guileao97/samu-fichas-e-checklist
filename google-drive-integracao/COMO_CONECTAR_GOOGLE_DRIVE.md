# Como Conectar o APK ao Google Drive da Base (SAMU 192 – Orlândia-SP)

Esta integração é **100% gratuita**, usa a própria conta Google escolhida pela coordenação do SAMU e **não exige que nenhum condutor ou técnico de enfermagem tenha a senha da conta Google da base** no celular pessoal.

---

## Passo a Passo (leva cerca de 3 minutos)

1. No computador, entre na conta Google onde ficarão salvos os PDFs das fichas e checklists e acesse:  
   **https://script.google.com**
2. Clique em **Novo projeto** (canto superior esquerdo).
3. Apague o texto inicial (`function myFunction() {}`) que aparecer na tela.
4. Abra o arquivo [`Codigo_Google_Apps_Script.gs`](./Codigo_Google_Apps_Script.gs) desta pasta, copie **todo o conteúdo** e cole no editor do Google Apps Script.
5. Clique no ícone de **Salvar** (disquete) e dê o nome `SAMU 192 Orlandia`.
6. No canto superior direito, clique no botão azul **Implantar** -> **Nova implantação**.
7. Clique na engrenagem ao lado de *"Selecione o tipo"* e escolha **App da Web**.
8. Preencha exatamente assim:
   - **Descrição:** `Sistema SAMU 192 Orlandia`
   - **Executar como:** `Eu` (seu e-mail da conta Google da base)
   - **Quem pode acessar:** `Qualquer pessoa` *(necessário para os celulares enviarem o PDF sem exigir login Google; o acesso aos dados continua protegido pelo Login e Senha individuais do sistema)*
9. Clique em **Implantar** e autorize as permissões da sua conta Google (*Avançado -> Acessar SAMU 192 Orlandia -> Permitir*).
10. Copie a **URL do App da Web** gerada (termina com `/exec`).

---

## Conectando no Aplicativo (APK)

1. Abra o aplicativo **SAMU 192 Orlândia** e entre como Administrador:
   - **Usuário inicial:** `admin`
   - **Senha inicial:** `samu192`
2. Toque na aba **Admin / Equipe** -> seção **Integração Google Drive**.
3. Cole a **URL do App da Web** (`/exec`) e toque em **Testar e Salvar Conexão** (você também pode gerar um código/link rápido para configurar os celulares da equipe em segundos!).
4. Pronto! O sistema criará sozinho no seu Google Drive a pasta:
   - 📁 `SAMU 192 Orlândia - Sistema Digital`
     - 📁 `Fichas de Atendimento` -> subpastas por mês (`2026-10`, `2026-11`, ...)
     - 📁 `Check List - Condutor Socorrista` -> subpastas por mês
     - 📁 `Check List - Enfermagem` -> subpastas por mês
     - 📊 `SAMU 192 Orlândia - Controle e Histórico` (Planilha Google com abas `Usuarios` e `Registros`)

---

## Como funcionam os Perfis e a Privacidade

- **Coordenação (`admin`)**:
  - Cadastra os logins e senhas de cada **Condutor Socorrista** e **Técnico de Enfermagem** direto pelo aplicativo (aba **Admin / Equipe**) ou pela aba `Usuarios` da planilha.
  - Vê **todas as Fichas de Atendimento** e **todos os Check Lists** (Condutores e Enfermagem), podendo pesquisar por **nome do paciente**, CPF, data, viatura ou profissional e abrir o PDF direto no Drive ou reimprimir.
- **Condutor Socorrista (`condutor`)**:
  - Preenche **Ficha de Atendimento USB** e **Check List – Condutor/Socorrista**.
  - No **Histórico**, vê **apenas as fichas e checklists feitos por ele**, com busca rápida por nome de paciente e data.
- **Técnico de Enfermagem (`enfermagem`)**:
  - Preenche **Ficha de Atendimento USB** e **Check List – Enfermagem (Checagem Diária USB)**.
  - No **Histórico**, vê **apenas as fichas e checklists feitos por ele**, com busca rápida por nome de paciente e data.
