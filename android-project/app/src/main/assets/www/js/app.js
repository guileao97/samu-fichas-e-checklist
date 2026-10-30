/* ============================================================================
 * SAMU 192 – ORLÂNDIA-SP | CONTROLADOR PRINCIPAL DO APLICATIVO INTERATIVO
 * ============================================================================ */

(function() {
  let currentUser = null;
  let activeTab = 'ficha';
  let fichaStep = 1;

  // Estados em edição
  let fichaState = null;
  let editingFichaId = null;

  let condutorState = null;
  let editingCondutorId = null;
  let activeDamageCode = 'A';

  let enfermagemState = null;
  let editingEnfermagemId = null;
  let activeEnfSectionIdx = 0;

  // Estado do filtro de histórico e listas rápidas
  let historySearch = '';
  let historyTypeFilter = 'all';
  let historyUserFilter = 'all';
  let medFilterQuery = '';
  let cachedDraftCount = 0;

  // Estado do modal de visualização de PDF e Foto p/ Regulação Médica
  let previewCurrentRecord = null;
  let previewGeneratedPdf = null;
  let regPhotoCurrentRecord = null;
  let regPhotoGenerated = null;

  function todayISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function nowHHMM() {
    const now = new Date();
    return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  }

  function uid(prefix) {
    return (prefix || 'rec') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  function normStr(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast-banner');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3400);
  }

  function samuConfirm(message, isAlertOnly) {
    return new Promise((resolve) => {
      let dlg = document.getElementById('samu-custom-dialog');
      if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'samu-custom-dialog';
        dlg.className = 'sig-modal hidden';
        dlg.style.zIndex = '150';
        document.body.appendChild(dlg);
      }
      dlg.innerHTML = `
        <div class="card" style="width:100%; max-width:380px; margin:0; padding:20px; text-align:center;">
          <div style="font-size:1.5rem; margin-bottom:6px;">${isAlertOnly ? 'ℹ️' : '⚠️'}</div>
          <p style="margin:0 0 16px; font-weight:700; font-size:0.96rem; color:var(--text);">${escapeHtml(message)}</p>
          <div style="display:flex; gap:8px; justify-content:center;">
            ${isAlertOnly ? '' : '<button type="button" class="btn btn-secondary" id="dlg-btn-no" style="flex:1;">Cancelar</button>'}
            <button type="button" class="btn btn-primary" id="dlg-btn-yes" style="flex:1;">${isAlertOnly ? 'Entendi' : 'Confirmar'}</button>
          </div>
        </div>
      `;
      dlg.classList.remove('hidden');
      const close = (val) => {
        dlg.classList.add('hidden');
        resolve(val);
      };
      document.getElementById('dlg-btn-yes').onclick = () => close(true);
      const noBtn = document.getElementById('dlg-btn-no');
      if (noBtn) noBtn.onclick = () => close(false);
    });
  }

  function samuAlert(message) {
    return samuConfirm(message, true);
  }

  function calcAgeFromDn(isoDate) {
    if (!isoDate) return '';
    const birth = new Date(isoDate + 'T00:00:00');
    const today = new Date();
    if (isNaN(birth.getTime())) return '';
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return (age >= 0 && age < 130) ? (age + ' anos') : '';
  }

  function formatCep(raw) {
    const d = String(raw || '').replace(/\D+/g, '').slice(0, 8);
    if (d.length <= 5) return d;
    return `${d.slice(0, 5)}-${d.slice(5)}`;
  }

  function createEmptyFicha() {
    const isEnf = currentUser && currentUser.role === 'enfermagem';
    const isCond = currentUser && currentUser.role === 'condutor';
    const savedSig = currentUser ? window.SamuStorage.getSavedSignature(currentUser.username) : '';
    const lastKm = window.SamuStorage.getLastKmFinal() || '';

    return {
      data: todayISO(),
      kmInicial: lastKm,
      kmFinal: '',
      motivoSolicitacao: '',
      risco: '',
      locaisOcorrencia: [],
      localOutroCheck: false,
      localOutroTexto: '',
      ocorrenciaCep: '',
      ocorrenciaEndereco: '',
      ocorrenciaNumero: '',
      ocorrenciaReferencia: '',
      ocorrenciaContato: '',

      vitimaNome: '',
      vitimaIdade: '',
      vitimaDn: '',
      vitimaEndereco: '',
      vitimaNumero: '',
      vitimaBairro: '',
      vitimaCidade: 'Orlândia',
      vitimaCep: '14620-000',
      vitimaNaturalidade: '',
      vitimaPai: '',
      vitimaMae: '',
      vitimaCpf: '',
      vitimaRg: '',
      vitimaCns: '',

      horarios: {
        horaChamado: '',
        horaTransmissao: '',
        horaSaida: '',
        horaChegadaLocal: '',
        horaSaidaLocal: '',
        horaChegadaHospital: '',
        horaSaidaHospital: '',
        horaRetornoBase: ''
      },

      tiposAtendimento: [],
      tipoOutroCheck: false,
      tipoOutroTexto: '',
      situacoesLocal: [],
      situacaoOutroCheck: false,
      situacaoOutroTexto: '',

      descricaoCena: '',
      burnZonesSelected: [],
      haQueimaduras: 'NAO',
      queimadurasPorcentagem: '',

      viaAerea: '',
      respiracao: '',
      circulacao: '',
      consciente: '',

      pupilaDirTamanho: '',
      pupilaDirReativa: '',
      pupilaEsqTamanho: '',
      pupilaEsqReativa: '',

      svPa: '',
      svFc: '',
      svFr: '',
      svSat: '',
      svDextro: '',
      svTemp: '',

      pele: [],
      antecedentes: [],
      medicamentosSelecionados: [],
      medicamentosOutro: '',
      medicamentosLista: ['', '', '', ''],
      alergiasSelecionadas: [],
      alergiasOutro: '',
      alergias: '',

      procedimentos: [],
      procOutroCheck: false,
      procOutroTexto: '',
      conduta: '',
      medicoRegulador: '',
      pertences: '',

      relatorioEnfermagem: '',
      termosSelecionados: [],
      termoNome: '',
      termoCpf: '',
      sigTermo: '',

      setorRecomendado: [],
      setorAdmitido: [],
      obsHospital: '',

      destino: (window.SamuStorage.getSettings().defaultHospital || 'HBSA'),
      recebidoPorNome: '',
      recebidoCorenCrm: '',
      sigRecebido: '',

      enfermagemNome: isEnf ? currentUser.name : '',
      enfermagemCoren: isEnf ? (currentUser.coren || currentUser.councilId || '') : '',
      sigEnfermagem: isEnf ? savedSig : '',

      condutorNome: isCond ? currentUser.name : '',
      sigCondutor: isCond ? savedSig : ''
    };
  }

  function normalizeFichaData(raw) {
    const base = createEmptyFicha();
    if (!raw || typeof raw !== 'object') return base;
    const merged = Object.assign({}, base, raw);
    merged.horarios = Object.assign({}, base.horarios, raw.horarios || {});

    // Migração suave de medicamentos antigos se houver
    if (!Array.isArray(merged.medicamentosSelecionados)) merged.medicamentosSelecionados = [];
    if (merged.medicamentosSelecionados.length === 0 && !merged.medicamentosOutro && Array.isArray(raw.medicamentosLista)) {
      const legacyMeds = raw.medicamentosLista.map(s => String(s || '').trim()).filter(Boolean);
      const known = window.SAMU_SCHEMA.medicamentosOpcoes || [];
      const others = [];
      legacyMeds.forEach(m => {
        if (known.includes(m)) merged.medicamentosSelecionados.push(m);
        else others.push(m);
      });
      if (others.length > 0) merged.medicamentosOutro = others.join(', ');
    }

    if (!Array.isArray(merged.alergiasSelecionadas)) merged.alergiasSelecionadas = [];
    if (merged.alergiasSelecionadas.length === 0 && !merged.alergiasOutro && raw.alergias) {
      const knownAl = window.SAMU_SCHEMA.alergiasOpcoes || [];
      const parts = String(raw.alergias).split(/[,;]+/).map(s => s.trim()).filter(Boolean);
      const others = [];
      parts.forEach(p => {
        if (knownAl.includes(p)) merged.alergiasSelecionadas.push(p);
        else others.push(p);
      });
      if (others.length > 0) merged.alergiasOutro = others.join(', ');
    }
    return merged;
  }

  function hasMeaningfulFichaData(d) {
    if (!d) return false;
    const defaultHosp = (window.SamuStorage.getSettings().defaultHospital || 'HBSA').toUpperCase();
    const customDestino = d.destino && String(d.destino).trim().toUpperCase() !== defaultHosp;
    if (d.vitimaNome || d.vitimaCpf || d.motivoSolicitacao || d.ocorrenciaEndereco || d.kmFinal || d.descricaoCena || d.relatorioEnfermagem || customDestino || d.recebidoPorNome) return true;
    if ((d.locaisOcorrencia && d.locaisOcorrencia.length) || (d.tiposAtendimento && d.tiposAtendimento.length) || (d.procedimentos && d.procedimentos.length)) return true;
    if ((d.medicamentosSelecionados && d.medicamentosSelecionados.length) || d.medicamentosOutro || (d.alergiasSelecionadas && d.alergiasSelecionadas.length) || d.alergiasOutro) return true;
    const h = d.horarios || {};
    return Object.keys(h).some(k => Boolean(h[k]));
  }

  function createEmptyCondutor() {
    const h = new Date().getHours();
    const isDiurno = (h >= 6 && h < 18);
    const uname = currentUser ? currentUser.name : '';
    const savedSig = currentUser ? window.SamuStorage.getSavedSignature(currentUser.username) : '';

    return {
      data: todayISO(),
      turnoAtivo: isDiurno ? 'DIURNO' : 'NOTURNO',
      viaturaId: 'master_29',
      outraPlaca: '',
      condutorDiurno: isDiurno ? uname : '',
      condutorNoturno: !isDiurno ? uname : '',
      abastLitros: '',
      abastHora: '',
      abastKm: '',
      abastAss: '',
      itensDiurno: {},
      itensNoturno: {},
      avariasDiurno: [],
      avariasNoturno: [],
      obsDiurno: '',
      obsNoturno: '',
      sigCondutorDiurno: isDiurno ? savedSig : '',
      sigCondutorNoturno: !isDiurno ? savedSig : ''
    };
  }

  function createEmptyEnfermagem() {
    const h = new Date().getHours();
    const isDia = (h >= 6 && h < 18);
    const savedSig = currentUser ? window.SamuStorage.getSavedSignature(currentUser.username) : '';

    return {
      data: todayISO(),
      turno: isDia ? 'DIA' : 'NOITE',
      responsavelNome: currentUser ? currentUser.name : '',
      responsavelCoren: currentUser ? (currentUser.coren || currentUser.councilId || '') : '',
      itensDia: {},
      itensNoite: {},
      obsPagina1: '',
      obsPagina2: '',
      sigEnfermagem: savedSig
    };
  }

  /* ===================== INICIALIZAÇÃO, AUTO-CADASTRO E LOGIN ===================== */
  function initApp() {
    const assets = window.SAMU_ASSETS || {};
    const setLogo = (id, src) => {
      const el = document.getElementById(id);
      if (el && src) el.src = src;
    };
    setLogo('login-logo-samu', assets.samu_logo);
    setLogo('login-logo-orlandia', assets.orlandia_logo);
    setLogo('top-logo-samu', assets.samu_logo);

    const settings = window.SamuStorage.getSettings();
    const urlInput = document.getElementById('login-script-url');
    const ghRepoInp = document.getElementById('login-github-repo');
    const ghTokenInp = document.getElementById('login-github-token');
    if (urlInput && settings.scriptUrl) urlInput.value = settings.scriptUrl;
    if (ghRepoInp && settings.githubRepo) ghRepoInp.value = settings.githubRepo;
    if (ghTokenInp && settings.githubToken) ghTokenInp.value = settings.githubToken;

    // Alternar entre "Entrar" e "Criar Cadastro" na tela inicial
    const tabLogin = document.getElementById('tab-auth-login');
    const tabRegister = document.getElementById('tab-auth-register');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    const switchAuthMode = (mode) => {
      const isReg = mode === 'register';
      if (tabLogin) tabLogin.classList.toggle('active', !isReg);
      if (tabRegister) tabRegister.classList.toggle('active', isReg);
      if (loginForm) loginForm.classList.toggle('hidden', isReg);
      if (registerForm) registerForm.classList.toggle('hidden', !isReg);
    };
    if (tabLogin) tabLogin.addEventListener('click', () => switchAuthMode('login'));
    if (tabRegister) tabRegister.addEventListener('click', () => switchAuthMode('register'));

    // Seleção de Função no Auto-Cadastro:
    // - Técnico / Enfermeiro -> Login, Senha, COREN e CPF (+ Nome)
    // - Condutor Socorrista -> Login, Senha e CPF (+ Nome, oculta COREN)
    document.querySelectorAll('[data-reg-role]').forEach(btn => {
      btn.addEventListener('click', () => {
        const role = btn.dataset.regRole;
        document.querySelectorAll('[data-reg-role]').forEach(b => b.classList.toggle('active', b === btn));
        const roleHidden = document.getElementById('reg-role');
        if (roleHidden) roleHidden.value = role;
        const corenWrap = document.getElementById('reg-coren-wrap');
        const corenInp = document.getElementById('reg-coren');
        if (role === 'condutor') {
          if (corenWrap) corenWrap.classList.add('hidden');
          if (corenInp) { corenInp.required = false; corenInp.value = ''; }
        } else {
          if (corenWrap) corenWrap.classList.remove('hidden');
          if (corenInp) corenInp.required = true;
        }
      });
    });

    const regCpfInp = document.getElementById('reg-cpf');
    if (regCpfInp) {
      regCpfInp.addEventListener('input', () => {
        regCpfInp.value = window.SamuStorage.formatCpf(regCpfInp.value);
      });
    }

    if (registerForm) {
      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-do-register');
        btn.disabled = true;
        btn.textContent = 'Enviando Cadastro...';
        try {
          const role = (document.getElementById('reg-role') && document.getElementById('reg-role').value) || 'enfermagem';
          const res = await window.SamuStorage.registerUserRequest({
            role,
            name: document.getElementById('reg-name').value.trim(),
            username: document.getElementById('reg-user').value.trim(),
            password: document.getElementById('reg-pass').value,
            coren: role === 'enfermagem' ? document.getElementById('reg-coren').value.trim() : '',
            cpf: document.getElementById('reg-cpf').value.trim()
          });
          const createdUser = res.user.username;
          registerForm.reset();
          switchAuthMode('login');
          document.getElementById('login-user').value = createdUser;
          await samuAlert(
            res.githubSynced
              ? `✅ Cadastro "${createdUser}" enviado ao GitHub e salvo na base interna! Assim que o Adm aprovar na aba "Aprovar", seu acesso estará liberado.`
              : `✅ Cadastro "${createdUser}" salvo na Base Interna! O Administrador poderá aprová-lo na aba "Aprovar" (e sincronizará com o GitHub assim que houver internet).`
          );
        } catch (err) {
          samuAlert(err.message || 'Não foi possível concluir o cadastro.');
        } finally {
          btn.disabled = false;
          btn.textContent = '📨 Enviar Cadastro p/ Aprovação do Adm';
        }
      });
    }

    document.getElementById('btn-toggle-login-drive').addEventListener('click', () => {
      document.getElementById('login-drive-box').classList.toggle('hidden');
    });

    document.getElementById('btn-save-login-drive').addEventListener('click', async () => {
      const val = document.getElementById('login-script-url').value.trim();
      const ghRepo = (document.getElementById('login-github-repo') && document.getElementById('login-github-repo').value.trim()) || '';
      const ghToken = (document.getElementById('login-github-token') && document.getElementById('login-github-token').value.trim()) || '';
      window.SamuStorage.saveSettings({ scriptUrl: val, githubRepo: ghRepo, githubToken: ghToken });

      if (ghRepo && navigator.onLine) {
        try {
          showToast('Consultando base de dados no GitHub...');
          await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: Boolean(ghToken) });
          showToast('✅ Base do GitHub sincronizada com a memória interna!');
        } catch (err) {
          samuAlert('Configuração salva, mas houve erro ao consultar o GitHub: ' + err.message);
        }
      } else {
        showToast('Configurações de conexão salvas neste aparelho!');
      }
      document.getElementById('login-drive-box').classList.add('hidden');
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-do-login');
      const u = document.getElementById('login-user').value.trim();
      const p = document.getElementById('login-pass').value;
      btn.disabled = true;
      btn.textContent = 'Autenticando...';
      try {
        const res = await window.SamuStorage.login(u, p);
        await enterSession(res.user);
        showToast(`Bem-vindo(a), ${res.user.name}!`);
      } catch (err) {
        samuAlert(err.message || 'Erro ao fazer login.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Entrar no Sistema';
      }
    });

    document.getElementById('btn-logout').addEventListener('click', async () => {
      if (!(await samuConfirm('Deseja sair da sua conta neste aparelho?'))) return;
      window.SamuStorage.setSession(null);
      currentUser = null;
      document.getElementById('app-shell').classList.add('hidden');
      document.getElementById('login-screen').classList.remove('hidden');
      document.getElementById('login-pass').value = '';
    });

    // Atalho para o Simulador trocar de perfil em 1 clique
    window.__samuQuickSwitch = async function(target) {
      if (target === 'logout' || target === 'register') {
        window.SamuStorage.setSession(null);
        currentUser = null;
        document.getElementById('app-shell').classList.add('hidden');
        document.getElementById('login-screen').classList.remove('hidden');
        const tabBtn = document.getElementById(target === 'register' ? 'tab-auth-register' : 'tab-auth-login');
        if (tabBtn) tabBtn.click();
        return;
      }
      const map = {
        admin: ['admin', 'samu192'],
        condutor: ['condutor', '1234'],
        enfermagem: ['enfermagem', '1234']
      };
      const creds = map[target];
      if (!creds) return;
      try {
        const res = await window.SamuStorage.login(creds[0], creds[1]);
        await enterSession(res.user);
        showToast(`Simulando visão: ${res.user.name}`);
      } catch (e) {
        const users = window.SamuStorage.getLocalUsers();
        const byRole = users.find(u => u.role === target);
        if (byRole) {
          window.SamuStorage.setSession(byRole);
          await enterSession(byRole);
          showToast(`Simulando visão: ${byRole.name}`);
        }
      }
    };

    window.addEventListener('message', (ev) => {
      if (ev && ev.data && ev.data.samuSimSwitch) {
        window.__samuQuickSwitch(ev.data.samuSimSwitch);
      }
    });

    document.getElementById('btn-sync-status').addEventListener('click', () => {
      triggerBackgroundSync(true);
    });

    // Botões do Modal de Preview de PDF
    document.getElementById('btn-preview-close').addEventListener('click', () => {
      document.getElementById('pdf-preview-modal').classList.add('hidden');
    });
    const btnPrevReg = document.getElementById('btn-preview-regulacao');
    if (btnPrevReg) {
      btnPrevReg.addEventListener('click', async () => {
        if (!previewCurrentRecord || previewCurrentRecord.type !== 'ficha') return;
        await openRegulacaoHeaderModal(previewCurrentRecord);
      });
    }
    document.getElementById('btn-preview-share').addEventListener('click', async () => {
      if (!previewCurrentRecord) return;
      await window.SamuPDF.downloadOrSharePdf(previewCurrentRecord, previewGeneratedPdf);
    });

    // Botões do Modal da Foto Recortada do Cabeçalho + Horários p/ Regulação Médica (WhatsApp)
    const regModal = document.getElementById('regulacao-photo-modal');
    const btnRegClose = document.getElementById('btn-reg-close');
    if (btnRegClose && regModal) {
      btnRegClose.addEventListener('click', () => regModal.classList.add('hidden'));
    }
    const btnRegSendWa = document.getElementById('btn-reg-send-whatsapp');
    if (btnRegSendWa) {
      btnRegSendWa.addEventListener('click', async () => {
        if (!regPhotoCurrentRecord) return;
        btnRegSendWa.disabled = true;
        btnRegSendWa.textContent = 'Abrindo WhatsApp...';
        try {
          const res = await window.SamuPDF.shareRegulacaoHeaderWhatsApp(regPhotoCurrentRecord, regPhotoGenerated);
          if (res.mode === 'pc_copied_and_downloaded') {
            showToast('📲 Foto copiada (cole c/ Ctrl+V no WhatsApp Web) e arquivo .JPG baixado! (No APK abre o WhatsApp direto)');
          } else if (res.mode === 'pc_downloaded') {
            showToast('📥 Foto do cabeçalho baixada em .JPG! (No APK do celular abre o WhatsApp direto)');
          } else if (res.mode === 'android_whatsapp' || res.mode === 'web_share') {
            showToast('📲 Enviando foto do cabeçalho para o WhatsApp da Regulação!');
          }
        } catch (err) {
          samuAlert('Erro ao preparar foto para o WhatsApp: ' + err.message);
        } finally {
          btnRegSendWa.disabled = false;
          btnRegSendWa.textContent = '📲 Enviar no WhatsApp da Regulação';
        }
      });
    }
    const btnRegCopy = document.getElementById('btn-reg-copy-img');
    if (btnRegCopy) {
      btnRegCopy.addEventListener('click', async () => {
        if (!regPhotoGenerated) return;
        try {
          await window.SamuPDF.copyRegulacaoHeaderToClipboard(regPhotoGenerated);
          showToast('📋 Foto do cabeçalho copiada! Basta colar (Ctrl+V) na conversa do WhatsApp.');
        } catch (err) {
          await window.SamuPDF.downloadRegulacaoHeaderJpg(regPhotoCurrentRecord, regPhotoGenerated);
          showToast('📥 Foto salva em .JPG para anexar no WhatsApp.');
        }
      });
    }
    const btnRegDl = document.getElementById('btn-reg-download-jpg');
    if (btnRegDl) {
      btnRegDl.addEventListener('click', async () => {
        if (!regPhotoCurrentRecord) return;
        await window.SamuPDF.downloadRegulacaoHeaderJpg(regPhotoCurrentRecord, regPhotoGenerated);
        showToast('📥 Foto .JPG do cabeçalho salva!');
      });
    }
    document.getElementById('btn-preview-print').addEventListener('click', async () => {
      if (!previewCurrentRecord) return;
      await window.SamuPDF.printRecord(previewCurrentRecord, previewGeneratedPdf);
    });
    document.getElementById('btn-preview-drive').addEventListener('click', async () => {
      if (!previewCurrentRecord || !previewGeneratedPdf) return;
      const settings = window.SamuStorage.getSettings();
      if (!settings.scriptUrl) {
        samuAlert('Configure primeiro a URL do Google Apps Script (em Base/GitHub ou na tela inicial) para enviar direto ao Google Drive.');
        return;
      }
      const btn = document.getElementById('btn-preview-drive');
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      try {
        const res = await window.SamuStorage.uploadRecordToDrive(previewCurrentRecord, previewGeneratedPdf.base64);
        await refreshSyncBadge();
        if (res.synced) {
          document.getElementById('preview-drive-status').textContent = '✅ PDF salvo no Google Drive com sucesso!';
          showToast('PDF enviado ao Google Drive!');
        } else {
          document.getElementById('preview-drive-status').textContent = '⏳ Sem sinal agora: salvo na fila para envio automático.';
          showToast('Salvo na fila offline! Enviará assim que conectar.');
        }
      } finally {
        btn.disabled = false;
        btn.textContent = '☁️ Enviar p/ Drive';
      }
    });

    // Sempre que detectar internet, puxa automaticamente a base de dados do GitHub + verifica atualização automática (OTA / APK)
    const updateLoginVersionFooter = () => {
      const footer = document.getElementById('login-version-footer');
      if (!footer || !window.SamuStorage.getInstalledAppVersion) return;
      const v = window.SamuStorage.getInstalledAppVersion();
      const repoLabel = (window.SamuStorage.getSettings().githubRepo || 'guileao97/samu-fichas-e-checklist').trim();
      footer.textContent = `📱 Versão v${v.apkVersionName} (Rev #${v.otaRevision}) • Auto-Update: ${repoLabel}`;
    };
    updateLoginVersionFooter();

    const showAutoUpdateBanner = (text, buttonLabel, onClickFn) => {
      const banner = document.getElementById('auto-update-banner');
      const txtEl = document.getElementById('auto-update-banner-text');
      const btnEl = document.getElementById('btn-auto-update-action');
      if (!banner || !txtEl || !btnEl) return;
      txtEl.textContent = text;
      btnEl.textContent = buttonLabel;
      btnEl.disabled = false;
      btnEl.onclick = onClickFn;
      banner.classList.remove('hidden');
    };

    window.__onApkDownloadProgress = (pct, msg) => {
      const banner = document.getElementById('auto-update-banner');
      const txtEl = document.getElementById('auto-update-banner-text');
      const btnEl = document.getElementById('btn-auto-update-action');
      if (banner && txtEl && btnEl) {
        banner.classList.remove('hidden');
        if (pct < 0) {
          txtEl.textContent = `⚠️ ${msg}`;
          btnEl.textContent = 'Tentar Novamente';
          btnEl.disabled = false;
        } else {
          txtEl.textContent = `📥 ${msg} (${pct}%)`;
          btnEl.textContent = pct >= 100 ? 'Instalando...' : `${pct}%`;
          btnEl.disabled = pct < 100;
        }
      }
    };

    const runAutoUpdateCheck = async (interactive) => {
      if (!window.SamuStorage.checkAndApplyAppUpdate) return;
      if (!navigator.onLine) {
        if (interactive) showToast('📴 Sem internet agora para buscar atualizações no GitHub.');
        return;
      }
      try {
        if (interactive) showToast('🚀 Consultando atualizações no GitHub...');
        const res = await window.SamuStorage.checkAndApplyAppUpdate();
        updateLoginVersionFooter();

        if (res.status === 'ota_applied') {
          if (!currentUser) {
            window.SamuStorage.reloadForOtaUpdate();
            return;
          }
          persistFichaDraft();
          showAutoUpdateBanner(
            `✨ Nova atualização automática (Revisão #${res.remote.otaRevision}) baixada do GitHub!`,
            '🔄 Aplicar Agora',
            () => {
              persistFichaDraft();
              window.SamuStorage.reloadForOtaUpdate();
            }
          );
          if (interactive) showToast(`✨ Revisão #${res.remote.otaRevision} baixada! Toque em Aplicar Agora.`);
          return;
        }

        if (res.status === 'apk_update_available') {
          const notes = res.remote.releaseNotes ? ` (${res.remote.releaseNotes})` : '';
          showAutoUpdateBanner(
            `🚀 Novo APK v${res.remote.apkVersionName} disponível no GitHub!${notes}`,
            '📲 Atualizar APK Agora',
            () => {
              persistFichaDraft();
              window.SamuStorage.startNativeApkDownload(res.downloadUrl);
            }
          );
          if (interactive) {
            if (await samuConfirm(`Nova versão v${res.remote.apkVersionName} do APK SAMU 192 encontrada no GitHub!\n\nDeseja baixar e instalar automaticamente agora?`)) {
              persistFichaDraft();
              window.SamuStorage.startNativeApkDownload(res.downloadUrl);
            }
          }
          return;
        }

        if (interactive) {
          if (res.status === 'repo_empty_yet') {
            showToast('🐙 Repositório guileao97/samu-fichas-e-checklist pronto para receber o primeiro envio!');
          } else {
            showToast(`✅ Aplicativo atualizado (v${res.local.apkVersionName} • Rev #${res.local.otaRevision})!`);
          }
        }
      } catch (err) {
        if (interactive) samuAlert('Erro ao verificar atualização no GitHub: ' + err.message);
      }
    };

    window.__samuCheckAppUpdate = runAutoUpdateCheck;

    const pullGitHubWheneverOnline = async () => {
      if (!navigator.onLine || !window.SamuStorage.hasGitHubConfigured()) return;
      try {
        await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: window.SamuStorage.getGitHubMeta().dirty });
        if (currentUser) {
          renderBottomNav();
          await refreshSyncBadge();
          if (activeTab === 'aprovacoes') renderAprovacoesView(true);
        }
      } catch (e) {}
      runAutoUpdateCheck(false);
    };

    window.addEventListener('online', () => {
      refreshSyncBadge();
      pullGitHubWheneverOnline();
      triggerBackgroundSync(false);
    });
    window.addEventListener('offline', refreshSyncBadge);

    // Callback nativo do Android ConnectivityManager assim que o celular pega Wi-Fi ou 4G
    window.__onAndroidNetworkOnline = () => {
      refreshSyncBadge();
      pullGitHubWheneverOnline();
      triggerBackgroundSync(false);
    };

    // Consulta inicial ao GitHub na abertura do APK e checagem periódica automática quando online
    pullGitHubWheneverOnline();
    setInterval(() => {
      if (!document.hidden && navigator.onLine) {
        pullGitHubWheneverOnline();
      }
    }, 60000);

    const existingSession = window.SamuStorage.getSession();
    if (existingSession) {
      enterSession(existingSession);
    }
  }

  async function enterSession(user) {
    // Recarrega dados mais frescos do usuário na base interna (ex: COREN atualizado)
    const freshLocal = window.SamuStorage.getLocalUsers().find(u => u.username.toLowerCase() === String(user.username || '').toLowerCase());
    if (freshLocal && freshLocal.active) {
      user = Object.assign({}, user, {
        name: freshLocal.name || user.name,
        coren: freshLocal.coren || freshLocal.councilId || user.coren || user.councilId || '',
        councilId: freshLocal.coren || freshLocal.councilId || user.councilId || '',
        cpf: freshLocal.cpf || user.cpf || ''
      });
      window.SamuStorage.setSession(user);
    }

    currentUser = user;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');

    document.getElementById('top-user-name').textContent = user.name;
    const roleLabels = {
      admin: 'ADM / COORDENAÇÃO',
      condutor: 'CONDUTOR SOCORRISTA',
      enfermagem: 'TÉC. ENFERMAGEM'
    };
    const userCoren = user.coren || user.councilId || '';
    const roleBadgeText = (user.role === 'enfermagem' && userCoren)
      ? `TÉC. ENFERM. • ${userCoren}`
      : (roleLabels[user.role] || user.role);
    document.getElementById('top-user-role').textContent = roleBadgeText;

    // Carrega rascunhos em andamento salvos deste usuário
    const draftFicha = await window.SamuStorage.getDraft(user.username, 'ficha');
    if (draftFicha && draftFicha.data) {
      if (draftFicha.data.__editingId) {
        editingFichaId = draftFicha.data.__editingId;
        fichaState = normalizeFichaData(draftFicha.data.state);
      } else {
        editingFichaId = null;
        fichaState = normalizeFichaData(draftFicha.data);
      }
    } else {
      fichaState = createEmptyFicha();
      editingFichaId = null;
    }

    // Garante que o COREN e Nome do Técnico (ou Nome do Condutor) e o Hospital padrão HBSA já venham pré-preenchidos!
    if (user.role === 'enfermagem') {
      if (!fichaState.enfermagemNome) fichaState.enfermagemNome = user.name;
      if (!fichaState.enfermagemCoren && userCoren) fichaState.enfermagemCoren = userCoren;
    } else if (user.role === 'condutor') {
      if (!fichaState.condutorNome) fichaState.condutorNome = user.name;
    }
    if (!fichaState.destino) {
      fichaState.destino = window.SamuStorage.getSettings().defaultHospital || 'HBSA';
    }

    const draftCond = await window.SamuStorage.getDraft(user.username, 'checklist_condutor');
    condutorState = (draftCond && draftCond.data) ? Object.assign(createEmptyCondutor(), draftCond.data) : createEmptyCondutor();
    editingCondutorId = null;

    const draftEnf = await window.SamuStorage.getDraft(user.username, 'checklist_enfermagem');
    enfermagemState = (draftEnf && draftEnf.data) ? Object.assign(createEmptyEnfermagem(), draftEnf.data) : createEmptyEnfermagem();
    if (user.role === 'enfermagem') {
      if (!enfermagemState.responsavelNome) enfermagemState.responsavelNome = user.name;
      if (!enfermagemState.responsavelCoren && userCoren) enfermagemState.responsavelCoren = userCoren;
    }
    editingEnfermagemId = null;

    await refreshDraftCount();
    const pendingCount = window.SamuStorage.getPendingUsers().length;
    if (user.role === 'admin') {
      activeTab = pendingCount > 0 ? 'aprovacoes' : 'historico';
    } else {
      activeTab = 'ficha';
    }
    renderBottomNav();
    renderActiveView();
    await refreshSyncBadge();
    triggerBackgroundSync(false);
  }

  async function refreshSyncBadge() {
    const btn = document.getElementById('btn-sync-status');
    const txt = document.getElementById('sync-status-text');
    if (!btn || !txt || !currentUser) return;

    const settings = window.SamuStorage.getSettings();
    const hasGh = window.SamuStorage.hasGitHubConfigured();
    const all = await window.SamuStorage.getVisibleRecords(currentUser);
    const pending = all.filter(r => r.syncStatus === 'pending').length;

    const isSql = window.SamuStorage.isNativeSqliteActive && window.SamuStorage.isNativeSqliteActive();
    btn.classList.remove('pending', 'synced');
    if (!navigator.onLine) {
      btn.classList.add('pending');
      txt.textContent = pending > 0 ? `📴 ${isSql ? 'SQLite' : 'Base Interna'} (${pending} fila)` : `📴 ${isSql ? 'SQLite Offline' : 'Base Interna'}`;
      return;
    }
    if (!settings.scriptUrl && !hasGh) {
      txt.textContent = isSql ? '🗄️ SQLite Nativo' : '🗄️ Base Interna';
      return;
    }
    if (pending > 0 && settings.scriptUrl) {
      btn.classList.add('pending');
      txt.textContent = `🔄 Enviar (${pending})`;
    } else {
      btn.classList.add('synced');
      txt.textContent = hasGh && settings.scriptUrl ? '🐙+☁️ Sync OK' : (hasGh ? '🐙 GitHub OK' : '☁️ Drive OK');
    }
  }

  async function triggerBackgroundSync(interactive) {
    if (!currentUser) return;
    const settings = window.SamuStorage.getSettings();
    const hasGh = window.SamuStorage.hasGitHubConfigured();

    if (!navigator.onLine) {
      if (interactive) showToast('📴 Sem internet agora: funcionando 100% pela Base Interna Offline! Puxará do GitHub assim que conectar.');
      return;
    }

    if (!settings.scriptUrl && !hasGh) {
      if (interactive) {
        if (currentUser.role === 'admin') {
          activeTab = 'admin';
          renderBottomNav();
          renderActiveView();
          showToast('Configure o repositório GitHub e/ou Google Drive abaixo.');
        } else {
          samuAlert('Funcionando na Base Interna Offline deste aparelho. Para sincronizar em rede, peça ao Adm para configurar o GitHub / Google Drive.');
        }
      }
      return;
    }

    try {
      if (interactive) showToast('Consultando GitHub e sincronizando dados...');
      const res = await window.SamuStorage.syncAllWithCloud();
      renderBottomNav();
      await refreshSyncBadge();
      if (activeTab === 'historico') renderHistoricoView();
      if (activeTab === 'aprovacoes') renderAprovacoesView(true);
      if (interactive) {
        if (res.uploadedCount > 0) {
          showToast(`✅ Base GitHub consultada e ${res.uploadedCount} PDF(s) enviado(s) ao Drive!`);
        } else {
          showToast('✅ Base Interna sincronizada com sucesso!');
        }
      }
    } catch (err) {
      if (interactive) samuAlert('Erro na sincronização: ' + err.message);
    }
  }

  function getNavTabsForRole(role) {
    if (role === 'admin') {
      const pendingUsersCount = window.SamuStorage.getPendingUsers().length;
      return [
        { id: 'historico', icon: '🔎', label: 'Histórico' },
        { id: 'aprovacoes', icon: '✅', label: 'Aprovar', badge: pendingUsersCount },
        { id: 'ficha', icon: '📋', label: 'Ficha' },
        { id: 'condutor', icon: '🚑', label: 'CK Cond.' },
        { id: 'enfermagem', icon: '🩺', label: 'CK Enf.' },
        { id: 'admin', icon: '⚙️', label: 'Base/GitHub' }
      ];
    }
    if (role === 'condutor') {
      return [
        { id: 'ficha', icon: '📋', label: 'Ficha USB' },
        { id: 'condutor', icon: '🚑', label: 'Check List' },
        { id: 'historico', icon: '🔎', label: 'Meu Histórico' }
      ];
    }
    return [
      { id: 'ficha', icon: '📋', label: 'Ficha USB' },
      { id: 'enfermagem', icon: '🩺', label: 'Check List' },
      { id: 'historico', icon: '🔎', label: 'Meu Histórico' }
    ];
  }

  function renderBottomNav() {
    const nav = document.getElementById('bottom-nav');
    const tabs = getNavTabsForRole(currentUser.role);
    nav.innerHTML = tabs.map(t => `
      <button type="button" class="nav-tab ${activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">
        ${t.badge > 0 ? `<span class="nav-badge">${t.badge}</span>` : ''}
        <span class="nav-icon">${t.icon}</span>
        <span>${t.label}</span>
      </button>
    `).join('');

    nav.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        renderBottomNav();
        renderActiveView();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  function renderActiveView() {
    if (activeTab === 'ficha') return renderFichaView();
    if (activeTab === 'condutor') return renderCondutorView();
    if (activeTab === 'enfermagem') return renderEnfermagemView();
    if (activeTab === 'historico') return renderHistoricoView();
    if (activeTab === 'aprovacoes') return renderAprovacoesView();
    if (activeTab === 'admin') return renderAdminView();
  }

  function persistFichaDraft() {
    if (!currentUser) return;
    if (editingFichaId) {
      window.SamuStorage.saveDraft(currentUser.username, 'ficha', { __editingId: editingFichaId, state: fichaState });
    } else {
      window.SamuStorage.saveDraft(currentUser.username, 'ficha', fichaState);
    }
  }

  async function refreshDraftCount() {
    if (!currentUser) {
      cachedDraftCount = 0;
      return 0;
    }
    const vis = await window.SamuStorage.getVisibleRecords(currentUser);
    cachedDraftCount = vis.filter(r => r.syncStatus === 'draft').length;
    document.querySelectorAll('.js-draft-count').forEach(el => {
      el.textContent = String(cachedDraftCount);
      el.style.display = cachedDraftCount > 0 ? 'inline-block' : 'none';
    });
    return cachedDraftCount;
  }

  function renderQuickDraftBarHtml(kind) {
    const isFicha = kind === 'ficha';
    return `
      <div class="quick-draft-bar">
        <div class="quick-draft-btns">
          <button type="button" class="btn-draft-save js-btn-save-draft" data-draft-kind="${kind}">
            📌 Salvar Rascunho
          </button>
          ${isFicha ? `
            <button type="button" class="btn-draft-new js-btn-save-new-ficha" title="Salva esta ocorrência como rascunho e abre uma nova ficha limpa para a próxima ocorrência">
              ➕ Salvar + Nova
            </button>
            <button type="button" class="btn-draft-whatsapp js-btn-send-regulacao" title="Gera a foto do cabeçalho preenchido até os horários para enviar à Regulação Médica no WhatsApp">
              📲 Cabeçalho Regulação
            </button>
          ` : ''}
          <button type="button" class="btn-draft-list js-btn-open-drafts">
            📂 Rascunhos
            <span class="draft-count-badge js-draft-count" style="display:${cachedDraftCount > 0 ? 'inline-block' : 'none'};">${cachedDraftCount}</span>
          </button>
        </div>
      </div>
    `;
  }

  function buildCondutorRecordObject(id, existing) {
    const d = condutorState;
    const vObj = window.SAMU_SCHEMA.viaturas.find(v => v.id === d.viaturaId);
    const vLabel = d.viaturaId === 'outra' ? (d.outraPlaca || 'Outra Viatura') : (vObj ? vObj.full : 'USB');
    return {
      id,
      type: 'checklist_condutor',
      date: d.data || todayISO(),
      createdAt: (existing && existing.createdAt) || new Date().toISOString(),
      createdBy: (existing && existing.createdBy) || currentUser.username,
      createdByName: (existing && existing.createdByName) || currentUser.name,
      createdByRole: (existing && existing.createdByRole) || currentUser.role,
      patientName: '',
      patientCpf: '',
      risk: '',
      incidentType: '',
      vehicle: vLabel,
      shift: d.turnoAtivo,
      summary: `Turno ${d.turnoAtivo} • ${vLabel}`,
      driveFileId: (existing && existing.driveFileId) || '',
      driveUrl: (existing && existing.driveUrl) || '',
      syncStatus: 'pending',
      data: JSON.parse(JSON.stringify(d))
    };
  }

  function buildEnfermagemRecordObject(id, existing) {
    const d = enfermagemState;
    return {
      id,
      type: 'checklist_enfermagem',
      date: d.data || todayISO(),
      createdAt: (existing && existing.createdAt) || new Date().toISOString(),
      createdBy: (existing && existing.createdBy) || currentUser.username,
      createdByName: (existing && existing.createdByName) || d.responsavelNome || currentUser.name,
      createdByRole: (existing && existing.createdByRole) || currentUser.role,
      patientName: '',
      patientCpf: '',
      risk: '',
      incidentType: '',
      vehicle: 'USB',
      shift: d.turno,
      summary: `Checagem Diária USB (${d.turno}) • ${d.responsavelNome || ''}`,
      driveFileId: (existing && existing.driveFileId) || '',
      driveUrl: (existing && existing.driveUrl) || '',
      syncStatus: 'pending',
      data: JSON.parse(JSON.stringify(d))
    };
  }

  async function saveCurrentAsDraftRecord(kind, startNewAfter) {
    if (!currentUser) return;
    if (kind === 'ficha') {
      if (startNewAfter && !editingFichaId && !hasMeaningfulFichaData(fichaState)) {
        fichaState = createEmptyFicha();
        fichaStep = 1;
        await window.SamuStorage.clearDraft(currentUser.username, 'ficha');
        renderFichaView();
        showToast('Nova ficha em branco pronta!');
        return;
      }

      if (fichaState.kmFinal && String(fichaState.kmFinal).trim() !== '') {
        window.SamuStorage.setLastKmFinal(fichaState.kmFinal);
      }

      const recId = editingFichaId || uid('ficha');
      const existing = editingFichaId ? await window.SamuStorage.getRecordById(editingFichaId) : null;
      const record = buildFichaRecordObject(recId, existing);
      record.syncStatus = 'draft';
      record.isDraft = true;
      record.updatedAt = new Date().toISOString();
      if (!fichaState.vitimaNome) {
        const hintParts = [
          fichaState.motivoSolicitacao,
          fichaState.ocorrenciaEndereco,
          (fichaState.horarios && fichaState.horarios.horaChamado) ? ('Chamado ' + fichaState.horarios.horaChamado) : ''
        ].filter(Boolean);
        record.patientName = hintParts.length > 0 ? ('Rascunho: ' + hintParts[0]) : 'Ocorrência em preenchimento';
      }

      await window.SamuStorage.saveRecordLocal(record);

      if (startNewAfter) {
        editingFichaId = null;
        fichaState = createEmptyFicha();
        fichaStep = 1;
        await window.SamuStorage.clearDraft(currentUser.username, 'ficha');
        await refreshDraftCount();
        renderFichaView();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const pulledKm = window.SamuStorage.getLastKmFinal();
        showToast(pulledKm
          ? `📌 Rascunho salvo! Nova ficha aberta (KM Inicial: ${pulledKm}).`
          : '📌 Rascunho salvo! Nova ficha aberta para a próxima ocorrência.');
      } else {
        editingFichaId = recId;
        persistFichaDraft();
        await refreshDraftCount();
        const y = window.scrollY;
        renderFichaView();
        window.scrollTo(0, y);
        showToast(`📌 Rascunho salvo às ${nowHHMM()}!`);
      }
      return;
    }

    if (kind === 'condutor') {
      const recId = editingCondutorId || uid('ckcond');
      const existing = editingCondutorId ? await window.SamuStorage.getRecordById(editingCondutorId) : null;
      const record = buildCondutorRecordObject(recId, existing);
      record.syncStatus = 'draft';
      record.isDraft = true;
      record.updatedAt = new Date().toISOString();
      await window.SamuStorage.saveRecordLocal(record);
      editingCondutorId = recId;
      await refreshDraftCount();
      showToast(`📌 Rascunho do Check List salvo às ${nowHHMM()}!`);
      return;
    }

    if (kind === 'enfermagem') {
      const recId = editingEnfermagemId || uid('ckenf');
      const existing = editingEnfermagemId ? await window.SamuStorage.getRecordById(editingEnfermagemId) : null;
      const record = buildEnfermagemRecordObject(recId, existing);
      record.syncStatus = 'draft';
      record.isDraft = true;
      record.updatedAt = new Date().toISOString();
      await window.SamuStorage.saveRecordLocal(record);
      editingEnfermagemId = recId;
      await refreshDraftCount();
      showToast(`📌 Rascunho da Checagem salvo às ${nowHHMM()}!`);
    }
  }

  async function openDraftsModal() {
    if (!currentUser) return;
    let dlg = document.getElementById('samu-drafts-modal');
    if (!dlg) {
      dlg = document.createElement('div');
      dlg.id = 'samu-drafts-modal';
      dlg.className = 'sig-modal hidden';
      dlg.style.zIndex = '140';
      document.body.appendChild(dlg);
    }

    const vis = await window.SamuStorage.getVisibleRecords(currentUser);
    const drafts = vis.filter(r => r.syncStatus === 'draft');
    cachedDraftCount = drafts.length;

    const cardsHtml = drafts.length === 0
      ? `<div style="text-align:center; padding:26px 12px; color:var(--muted);">
           <div style="font-size:1.9rem; margin-bottom:6px;">📌</div>
           <strong>Nenhum rascunho pendente</strong>
           <p style="font-size:0.84rem; margin:6px 0 0;">Quando houver várias ocorrências seguidas, toque em <strong>Salvar Rascunho</strong> ou <strong>Salvar + Nova</strong> em qualquer página para guardar e terminar depois.</p>
         </div>`
      : drafts.map(rec => {
          const isF = rec.type === 'ficha';
          const isC = rec.type === 'checklist_condutor';
          const badge = isF ? 'Ficha USB' : (isC ? 'CK Condutor' : 'CK Enfermagem');
          const badgeCls = isF ? 'type-ficha' : (isC ? 'type-condutor' : 'type-enfermagem');
          const title = isF ? (rec.patientName || 'Ocorrência em andamento') : (rec.summary || badge);
          const dParts = String(rec.date || '').split('-');
          const dateBR = dParts.length === 3 ? `${dParts[2]}/${dParts[1]}/${dParts[0]}` : rec.date;
          const kmInfo = (isF && rec.data && (rec.data.kmInicial || rec.data.kmFinal))
            ? ` • KM: ${rec.data.kmInicial || '?'} → ${rec.data.kmFinal || '?'}`
            : '';
          return `
            <div style="border:1.5px solid #e2e8f0; border-radius:12px; padding:11px; margin-bottom:9px; background:#f8fafc;">
              <div style="display:flex; justify-content:space-between; gap:6px; align-items:center; margin-bottom:4px;">
                <span class="type-badge ${badgeCls}">${badge}</span>
                <span class="status-tag status-draft">📌 Rascunho</span>
              </div>
              <div style="font-weight:800; font-size:0.95rem; color:var(--text); margin-bottom:3px;">${escapeHtml(title)}</div>
              <div style="font-size:0.78rem; color:var(--muted); margin-bottom:8px;">
                📅 ${escapeHtml(dateBR)}${rec.shift ? ` • ⏱ ${escapeHtml(rec.shift)}` : ''}${escapeHtml(kmInfo)}
                ${rec.incidentType ? `<br>🚨 ${escapeHtml(rec.incidentType)}` : ''}
                ${rec.summary ? `<br>📍 ${escapeHtml(rec.summary)}` : ''}
              </div>
              <div style="display:flex; gap:6px;">
                <button type="button" class="btn btn-primary btn-sm" style="flex:1;" data-resume-draft="${escapeHtml(rec.id)}">✏️ Continuar Preenchimento</button>
                <button type="button" class="btn btn-secondary btn-sm" data-del-draft="${escapeHtml(rec.id)}">🗑️</button>
              </div>
            </div>
          `;
        }).join('');

    dlg.innerHTML = `
      <div class="card" style="width:100%; max-width:480px; max-height:86vh; margin:0; padding:16px; display:flex; flex-direction:column;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div>
            <strong style="font-size:1.02rem;">📂 Rascunhos em Aberto (${drafts.length})</strong>
            <div style="font-size:0.76rem; color:var(--muted);">Retome qualquer ocorrência para terminar e enviar ao Drive</div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-close-drafts-modal">Fechar</button>
        </div>
        <div style="overflow-y:auto; flex:1; padding-right:2px;">
          ${cardsHtml}
        </div>
      </div>
    `;
    dlg.classList.remove('hidden');

    document.getElementById('btn-close-drafts-modal').onclick = () => dlg.classList.add('hidden');

    dlg.querySelectorAll('[data-resume-draft]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetId = btn.dataset.resumeDraft;
        const rec = await window.SamuStorage.getRecordById(targetId);
        if (!rec) return;

        // Se o usuário estava digitando outra ficha nova ainda não salva na lista, salva automaticamente antes de trocar!
        if (rec.type === 'ficha' && !editingFichaId && hasMeaningfulFichaData(fichaState)) {
          await saveCurrentAsDraftRecord('ficha', false);
        }

        if (rec.type === 'ficha') {
          fichaState = normalizeFichaData(rec.data);
          editingFichaId = rec.id;
          fichaStep = 1;
          persistFichaDraft();
          activeTab = 'ficha';
        } else if (rec.type === 'checklist_condutor') {
          condutorState = Object.assign(createEmptyCondutor(), rec.data || {});
          editingCondutorId = rec.id;
          activeTab = 'condutor';
        } else if (rec.type === 'checklist_enfermagem') {
          enfermagemState = Object.assign(createEmptyEnfermagem(), rec.data || {});
          editingEnfermagemId = rec.id;
          activeTab = 'enfermagem';
        }
        dlg.classList.add('hidden');
        renderBottomNav();
        renderActiveView();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showToast('✏️ Rascunho carregado para continuar o preenchimento!');
      });
    });

    dlg.querySelectorAll('[data-del-draft]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetId = btn.dataset.delDraft;
        if (!(await samuConfirm('Excluir este rascunho permanentemente deste aparelho?'))) return;
        await window.SamuStorage.deleteRecordLocal(targetId);
        if (editingFichaId === targetId) {
          editingFichaId = null;
          fichaState = createEmptyFicha();
          await window.SamuStorage.clearDraft(currentUser.username, 'ficha');
        }
        if (editingCondutorId === targetId) editingCondutorId = null;
        if (editingEnfermagemId === targetId) editingEnfermagemId = null;
        await refreshDraftCount();
        renderActiveView();
        openDraftsModal();
      });
    });
  }

  function bindQuickDraftBarEvents(container) {
    container.querySelectorAll('.js-btn-save-draft').forEach(btn => {
      btn.addEventListener('click', () => {
        saveCurrentAsDraftRecord(btn.dataset.draftKind || 'ficha', false);
      });
    });
    container.querySelectorAll('.js-btn-save-new-ficha').forEach(btn => {
      btn.addEventListener('click', () => {
        saveCurrentAsDraftRecord('ficha', true);
      });
    });
    container.querySelectorAll('.js-btn-open-drafts').forEach(btn => {
      btn.addEventListener('click', () => {
        openDraftsModal();
      });
    });
    container.querySelectorAll('.js-btn-send-regulacao').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tempRecord = buildFichaRecordObject(editingFichaId || uid('ficha'));
        await openRegulacaoHeaderModal(tempRecord);
      });
    });
  }

  /* ==========================================================================
   * ABA 1: FICHA DE ATENDIMENTO USB INTERATIVA (6 ETAPAS RÁPIDAS)
   * ========================================================================== */
  function renderFichaView() {
    const container = document.getElementById('main-view');
    const d = fichaState;
    const steps = [
      { n: 1, label: '1. Ocorrência' },
      { n: 2, label: '2. Vítima' },
      { n: 3, label: '3. Horários' },
      { n: 4, label: '4. Avaliação' },
      { n: 5, label: '5. Conduta/Relatório' },
      { n: 6, label: '6. Assinaturas' }
    ];

    let stepHtml = '';

    if (fichaStep === 1) {
      const lastKmSaved = window.SamuStorage.getLastKmFinal();
      stepHtml = `
        <div class="card">
          <div class="card-title">
            <span>📍 Dados da Solicitação e Ocorrência</span>
          </div>
          <div class="grid-3">
            <div class="field">
              <label>Data</label>
              <input type="date" data-f="data" value="${escapeHtml(d.data)}" />
            </div>
            <div class="field">
              <label style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
                <span>KM Inicial</span>
                ${lastKmSaved ? `<button type="button" id="btn-use-last-km" style="background:none;border:none;padding:0;color:var(--success);font-size:0.72rem;font-weight:800;cursor:pointer;" title="Toque para usar o último KM Final salvo">↺ Último: ${escapeHtml(lastKmSaved)}</button>` : ''}
              </label>
              <input type="number" inputmode="numeric" id="inp-km-inicial" placeholder="Ex: 84520" data-f="kmInicial" value="${escapeHtml(d.kmInicial)}" />
            </div>
            <div class="field">
              <label>KM Final <small style="color:var(--muted);font-weight:600;">(vira próximo inicial)</small></label>
              <input type="number" inputmode="numeric" id="inp-km-final" placeholder="Ex: 84532" data-f="kmFinal" value="${escapeHtml(d.kmFinal)}" />
            </div>
          </div>

          <div class="field">
            <label>Motivo da Solicitação</label>
            <input type="text" placeholder="Ex: Queda da própria altura / Dor torácica / Colisão moto x carro" data-f="motivoSolicitacao" value="${escapeHtml(d.motivoSolicitacao)}" />
          </div>

          <div class="section-subtitle">Classificação de Risco</div>
          <div class="risk-grid">
            ${window.SAMU_SCHEMA.riscos.map(r => {
              const sel = d.risco === r.id;
              const style = sel
                ? `background:${r.color};border-color:${r.color};color:#fff;`
                : `background:${r.bg};border-color:${r.color};color:${r.color};`;
              return `<button type="button" class="risk-btn" data-risco="${r.id}" style="${style}">${r.label}</button>`;
            }).join('')}
          </div>

          <div class="section-subtitle">Local da Ocorrência</div>
          <div class="chips-wrap" style="margin-bottom:10px;">
            ${window.SAMU_SCHEMA.locaisOcorrencia.map(loc => `
              <button type="button" class="chip-btn ${(d.locaisOcorrencia || []).includes(loc) ? 'selected' : ''}" data-arr="locaisOcorrencia" data-val="${escapeHtml(loc)}">${loc}</button>
            `).join('')}
          </div>
          <div class="field">
            <label>Outro Local (opcional)</label>
            <input type="text" placeholder="Se outro local, especifique aqui..." data-f="localOutroTexto" value="${escapeHtml(d.localOutroTexto)}" />
          </div>

          <div class="grid-3">
            <div class="field">
              <label>CEP do Local (Wi-Fi/4G)</label>
              <div class="input-action-row">
                <input type="text" inputmode="numeric" id="inp-occ-cep" placeholder="00000-000" data-f="ocorrenciaCep" value="${escapeHtml(d.ocorrenciaCep || '')}" />
                <button type="button" class="btn-lookup" id="btn-lookup-occ-cep">🔍 CEP</button>
              </div>
              <div id="occ-cep-hint" class="field-hint"></div>
            </div>
            <div class="field">
              <label>Endereço da Ocorrência</label>
              <input type="text" id="inp-occ-end" placeholder="Rua / Avenida / Rodovia" data-f="ocorrenciaEndereco" value="${escapeHtml(d.ocorrenciaEndereco)}" />
            </div>
            <div class="field">
              <label>Número / KM</label>
              <input type="text" id="inp-occ-num" placeholder="Nº ou KM" data-f="ocorrenciaNumero" value="${escapeHtml(d.ocorrenciaNumero)}" />
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label>Ponto de Referência / Bairro</label>
              <input type="text" id="inp-occ-ref" placeholder="Próximo a..." data-f="ocorrenciaReferencia" value="${escapeHtml(d.ocorrenciaReferencia)}" />
            </div>
            <div class="field">
              <label>Contato / Telefone</label>
              <input type="tel" placeholder="(16) 99999-9999" data-f="ocorrenciaContato" value="${escapeHtml(d.ocorrenciaContato)}" />
            </div>
          </div>
        </div>
      `;
    } else if (fichaStep === 2) {
      const cleanCpfDigits = String(d.vitimaCpf || '').replace(/\D+/g, '');
      const cpfHintInit = cleanCpfDigits.length === 11
        ? (window.SamuStorage.isValidCpf(cleanCpfDigits)
            ? '<span class="hint-ok">✅ CPF válido</span>'
            : '<span class="hint-err">⚠️ Dígito verificador do CPF inválido</span>')
        : '';

      stepHtml = `
        <div class="card">
          <div class="card-title">
            <span>👤 Dados da Vítima / Paciente</span>
            <button type="button" class="btn btn-outline btn-sm" id="btn-copy-occ-addr">📍 Usar Endereço da Ocorrência</button>
          </div>

          <div class="grid-3">
            <div class="field">
              <label>CPF (puxa cadastro salvo / Wi-Fi)</label>
              <div class="input-action-row">
                <input type="text" inputmode="numeric" id="inp-vitima-cpf" placeholder="000.000.000-00" data-f="vitimaCpf" value="${escapeHtml(d.vitimaCpf)}" />
                <button type="button" class="btn-lookup" id="btn-lookup-cpf" title="Buscar dados do paciente pelo CPF">🔍 CPF</button>
              </div>
              <div id="cpf-lookup-hint" class="field-hint">${cpfHintInit}</div>
            </div>
            <div class="field">
              <label>RG</label>
              <input type="text" id="inp-vitima-rg" placeholder="RG" data-f="vitimaRg" value="${escapeHtml(d.vitimaRg)}" />
            </div>
            <div class="field">
              <label>Cartão SUS (CNS)</label>
              <input type="text" id="inp-vitima-cns" inputmode="numeric" placeholder="Opcional" data-f="vitimaCns" value="${escapeHtml(d.vitimaCns)}" />
            </div>
          </div>

          <div class="field">
            <label>Nome Completo da Vítima (usado na busca do histórico)</label>
            <input type="text" id="inp-vitima-nome" placeholder="Digite o nome do paciente" data-f="vitimaNome" value="${escapeHtml(d.vitimaNome)}" />
          </div>
          <div class="grid-2">
            <div class="field">
              <label>Data de Nascimento (DN)</label>
              <input type="date" id="inp-vitima-dn" data-f="vitimaDn" value="${escapeHtml(d.vitimaDn)}" />
            </div>
            <div class="field">
              <label>Idade</label>
              <input type="text" id="inp-vitima-idade" placeholder="Ex: 54 anos" data-f="vitimaIdade" value="${escapeHtml(d.vitimaIdade)}" />
            </div>
          </div>

          <div class="grid-3">
            <div class="field">
              <label>CEP Residencial (puxa rua no Wi-Fi)</label>
              <div class="input-action-row">
                <input type="text" inputmode="numeric" id="inp-vitima-cep" placeholder="00000-000" data-f="vitimaCep" value="${escapeHtml(d.vitimaCep)}" onfocus="this.select()" />
                <button type="button" class="btn-lookup" id="btn-lookup-vit-cep" title="Buscar endereço pelo CEP online">🔍 CEP</button>
              </div>
              <div id="cep-lookup-hint" class="field-hint"></div>
            </div>
            <div class="field">
              <label>Cidade</label>
              <input type="text" id="inp-vitima-cidade" data-f="vitimaCidade" value="${escapeHtml(d.vitimaCidade)}" />
            </div>
            <div class="field">
              <label>Bairro</label>
              <input type="text" id="inp-vitima-bairro" placeholder="Bairro" data-f="vitimaBairro" value="${escapeHtml(d.vitimaBairro)}" />
            </div>
          </div>

          <div class="grid-3">
            <div class="field" style="grid-column: span 2;">
              <label>Endereço Residencial</label>
              <input type="text" id="inp-vitima-end" placeholder="Rua / Av." data-f="vitimaEndereco" value="${escapeHtml(d.vitimaEndereco)}" />
            </div>
            <div class="field">
              <label>Número</label>
              <input type="text" id="inp-vitima-num" placeholder="Nº" data-f="vitimaNumero" value="${escapeHtml(d.vitimaNumero)}" />
            </div>
          </div>

          <div class="grid-3">
            <div class="field">
              <label>Naturalidade</label>
              <input type="text" id="inp-vitima-nat" placeholder="Cidade/UF" data-f="vitimaNaturalidade" value="${escapeHtml(d.vitimaNaturalidade)}" />
            </div>
            <div class="field">
              <label>Nome do Pai</label>
              <input type="text" id="inp-vitima-pai" data-f="vitimaPai" value="${escapeHtml(d.vitimaPai)}" />
            </div>
            <div class="field">
              <label>Nome da Mãe</label>
              <input type="text" id="inp-vitima-mae" data-f="vitimaMae" value="${escapeHtml(d.vitimaMae)}" />
            </div>
          </div>
        </div>
      `;
    } else if (fichaStep === 3) {
      stepHtml = `
        <div class="card">
          <div class="card-title">
            <span>⏱️ Controle de Horários da Ocorrência</span>
          </div>
          <p style="margin:0 0 12px; font-size:0.84rem; color:var(--muted);">
            Toque em <strong>AGORA</strong> para cravar o horário exato com 1 toque ou digite manualmente.
          </p>
          <div class="time-grid">
            ${window.SAMU_SCHEMA.horariosFicha.map(h => `
              <div class="time-card">
                <label>${h.label}</label>
                <div class="time-input-row">
                  <input type="time" data-horario="${h.key}" value="${escapeHtml((d.horarios && d.horarios[h.key]) || '')}" />
                  <button type="button" class="btn-now" data-now="${h.key}">⏱ AGORA</button>
                </div>
              </div>
            `).join('')}
          </div>

          <div class="regulacao-callout">
            <div style="font-size:0.84rem; color:#14532d; font-weight:700;">
              📲 <strong>Envio para a Regulação Médica:</strong> gera uma foto nítida apenas da parte frontal do PDF preenchido — do início da ficha até esta barra de Horários (Chamado, Saída, Chegada...).
            </div>
            <button type="button" class="btn btn-whatsapp js-btn-send-regulacao">
              📲 Enviar Cabeçalho p/ Regulação no WhatsApp
            </button>
          </div>
        </div>
      `;
    } else if (fichaStep === 4) {
      const assets = window.SAMU_ASSETS || {};
      const tiposFlat = window.SAMU_SCHEMA.tiposAtendimentoGrid.flat().filter(x => x !== '__OUTRO__');
      stepHtml = `
        <div class="card">
          <div class="card-title"><span>🚨 Tipo de Atendimento &amp; Cena</span></div>
          <div class="chips-wrap" style="margin-bottom:10px;">
            ${tiposFlat.map(tp => `
              <button type="button" class="chip-btn ${(d.tiposAtendimento || []).includes(tp) ? 'selected' : ''}" data-arr="tiposAtendimento" data-val="${escapeHtml(tp)}">${tp}</button>
            `).join('')}
          </div>
          <div class="field">
            <label>Outro Tipo de Atendimento (opcional)</label>
            <input type="text" placeholder="Especifique se outro..." data-f="tipoOutroTexto" value="${escapeHtml(d.tipoOutroTexto)}" />
          </div>

          <div class="section-subtitle">Situação do Local</div>
          <div class="chips-wrap" style="margin-bottom:10px;">
            ${window.SAMU_SCHEMA.situacoesLocal.map(st => `
              <button type="button" class="chip-btn ${(d.situacoesLocal || []).includes(st) ? 'selected' : ''}" data-arr="situacoesLocal" data-val="${escapeHtml(st)}">${st}</button>
            `).join('')}
          </div>
          <div class="field">
            <label>Outra Situação do Local (opcional)</label>
            <input type="text" placeholder="Se outra situação..." data-f="situacaoOutroTexto" value="${escapeHtml(d.situacaoOutroTexto)}" />
          </div>

          <div class="field">
            <label>Descrição de Cena</label>
            <textarea rows="4" placeholder="Descreva como a vítima foi encontrada, mecanismo do trauma/quadro clínico..." data-f="descricaoCena">${escapeHtml(d.descricaoCena)}</textarea>
          </div>

          <div class="section-subtitle">Queimaduras – Regra dos 9 Interativa</div>
          <div class="burn-interactive-box">
            <div style="font-size:0.84rem; color:var(--muted); text-align:center;">
              Toque nas partes do corpo atingidas (Frente / Costas) para somar automaticamente a %:
            </div>
            <div class="burn-stage">
              <img src="${assets.burn_diagram || ''}" alt="Regra dos 9" />
              ${window.SAMU_SCHEMA.burnZones.map(z => {
                const active = (d.burnZonesSelected || []).includes(z.id);
                return `<button type="button" class="burn-zone-btn ${active ? 'active' : ''}"
                  data-burn="${z.id}" title="${z.label} (${z.pct}%)"
                  style="left:${z.cx * 100}%; top:${z.cy * 100}%; width:${z.rx * 200}%; height:${z.ry * 200}%;"></button>`;
              }).join('')}
            </div>
            <div class="grid-3" style="width:100%; align-items:end;">
              <div class="field" style="margin:0;">
                <label>Há Queimaduras?</label>
                <select data-f="haQueimaduras" id="sel-ha-queimaduras">
                  <option value="NAO" ${d.haQueimaduras !== 'SIM' ? 'selected' : ''}>NÃO</option>
                  <option value="SIM" ${d.haQueimaduras === 'SIM' ? 'selected' : ''}>SIM</option>
                </select>
              </div>
              <div class="field" style="margin:0;">
                <label>% Superfície Queimada</label>
                <input type="text" id="inp-burn-pct" placeholder="Ex: 18%" data-f="queimadurasPorcentagem" value="${escapeHtml(d.queimadurasPorcentagem)}" />
              </div>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-clear-burns" style="height:42px;">Limpar Boneco</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">
            <span>🩺 Avaliação Primária, Pupilas &amp; Sinais Vitais</span>
            <button type="button" class="btn btn-outline btn-sm" id="btn-av-all-yes">✅ Todos SIM</button>
          </div>

          ${[
            { key: 'viaAerea', label: 'Via Aérea Liberada' },
            { key: 'respiracao', label: 'Respiração Presente' },
            { key: 'circulacao', label: 'Circulação Presente' },
            { key: 'consciente', label: 'Paciente Consciente' }
          ].map(row => `
            <div class="yn-row">
              <span>${row.label}</span>
              <div class="yn-btns">
                <button type="button" class="yn-btn ${d[row.key] === 'SIM' ? 'active-yes' : ''}" data-yn="${row.key}" data-val="SIM">SIM</button>
                <button type="button" class="yn-btn ${d[row.key] === 'NAO' ? 'active-no' : ''}" data-yn="${row.key}" data-val="NAO">NÃO</button>
              </div>
            </div>
          `).join('')}

          <div class="section-subtitle" style="display:flex; justify-content:space-between; align-items:center;">
            <span>Pupilas (Direita e Esquerda)</span>
            <button type="button" class="btn btn-outline btn-sm" id="btn-pupilas-normais">👁️ Isocóricas + Reativas</button>
          </div>

          ${[
            { title: 'PUPILA DIREITA', sizeKey: 'pupilaDirTamanho', reactKey: 'pupilaDirReativa' },
            { title: 'PUPILA ESQUERDA', sizeKey: 'pupilaEsqTamanho', reactKey: 'pupilaEsqReativa' }
          ].map(p => `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:10px; margin-bottom:10px;">
              <strong style="font-size:0.82rem;">${p.title}</strong>
              <div class="pupil-selector">
                <div class="pupil-card ${d[p.sizeKey] === 'GRANDE' ? 'selected' : ''}" data-pupil="${p.sizeKey}" data-val="GRANDE">
                  <img src="${assets.pupil_large || ''}" alt="Midríase" />
                  <small>Dilatada (Midríase)</small>
                </div>
                <div class="pupil-card ${d[p.sizeKey] === 'MEDIA' ? 'selected' : ''}" data-pupil="${p.sizeKey}" data-val="MEDIA">
                  <img src="${assets.pupil_medium || ''}" alt="Normal" />
                  <small>Normal (Média)</small>
                </div>
                <div class="pupil-card ${d[p.sizeKey] === 'PEQUENA' ? 'selected' : ''}" data-pupil="${p.sizeKey}" data-val="PEQUENA">
                  <img src="${assets.pupil_small || ''}" alt="Miose" />
                  <small>Contraída (Miose)</small>
                </div>
              </div>
              <div class="yn-row" style="margin:0; background:#fff;">
                <span>Reativa à luz?</span>
                <div class="yn-btns">
                  <button type="button" class="yn-btn ${d[p.reactKey] === 'SIM' ? 'active-yes' : ''}" data-yn="${p.reactKey}" data-val="SIM">SIM</button>
                  <button type="button" class="yn-btn ${d[p.reactKey] === 'NAO' ? 'active-no' : ''}" data-yn="${p.reactKey}" data-val="NAO">NÃO</button>
                </div>
              </div>
            </div>
          `).join('')}

          <div class="section-subtitle">Sinais Vitais</div>
          <div class="grid-3">
            <div class="field"><label>PA (mmHg)</label><input type="text" placeholder="Ex: 120x80" data-f="svPa" value="${escapeHtml(d.svPa)}" /></div>
            <div class="field"><label>FC (bpm)</label><input type="text" inputmode="numeric" placeholder="Ex: 84" data-f="svFc" value="${escapeHtml(d.svFc)}" /></div>
            <div class="field"><label>FR (irpm)</label><input type="text" inputmode="numeric" placeholder="Ex: 18" data-f="svFr" value="${escapeHtml(d.svFr)}" /></div>
            <div class="field"><label>SAT (%)</label><input type="text" placeholder="Ex: 98%" data-f="svSat" value="${escapeHtml(d.svSat)}" /></div>
            <div class="field"><label>DEXTRO (mg/dL)</label><input type="text" placeholder="Ex: 105" data-f="svDextro" value="${escapeHtml(d.svDextro)}" /></div>
            <div class="field"><label>TEMP. (°C)</label><input type="text" placeholder="Ex: 36,5" data-f="svTemp" value="${escapeHtml(d.svTemp)}" /></div>
          </div>

          <div class="section-subtitle">Pele</div>
          <div class="chips-wrap">
            ${window.SAMU_SCHEMA.peleOpcoes.map(op => `
              <button type="button" class="chip-btn ${(d.pele || []).includes(op) ? 'selected' : ''}" data-arr="pele" data-val="${escapeHtml(op)}">${op}</button>
            `).join('')}
          </div>

          <div class="section-subtitle">Antecedentes Patológicos</div>
          <div class="chips-wrap" style="margin-bottom:12px;">
            ${window.SAMU_SCHEMA.antecedentesOpcoes.map(op => `
              <button type="button" class="chip-btn ${(d.antecedentes || []).includes(op) ? 'selected' : ''}" data-arr="antecedentes" data-val="${escapeHtml(op)}">${op}</button>
            `).join('')}
          </div>

          <div class="section-subtitle">Medicamentos em Uso</div>
          <input type="search" id="inp-med-filter" class="med-filter-input" placeholder="🔎 Filtrar medicamento da lista (ex: Losartana, Rivotril, Glifage)..." value="${escapeHtml(medFilterQuery)}" />
          <div class="chips-wrap" id="med-chips-container" style="margin-bottom:10px;">
            ${(window.SAMU_SCHEMA.medicamentosOpcoes || []).filter(op => {
              if (!medFilterQuery.trim()) return true;
              return normStr(op).includes(normStr(medFilterQuery.trim()));
            }).map(op => {
              const sel = (d.medicamentosSelecionados || []).includes(op);
              const isNega = op === 'Nega';
              return `<button type="button" class="chip-btn ${isNega ? 'chip-nega' : ''} ${sel ? 'selected' : ''}" data-med-chip="${escapeHtml(op)}">${escapeHtml(op)}</button>`;
            }).join('')}
          </div>
          <div class="field">
            <label>Outro(s) Medicamento(s) que não estão na lista (separe por vírgula)</label>
            <input type="text" id="inp-med-outro" placeholder="Digite aqui se o paciente usar outro medicamento..." data-f="medicamentosOutro" value="${escapeHtml(d.medicamentosOutro || '')}" />
          </div>

          <div class="section-subtitle">Alergias</div>
          <div class="chips-wrap" style="margin-bottom:10px;">
            ${(window.SAMU_SCHEMA.alergiasOpcoes || []).map(op => {
              const sel = (d.alergiasSelecionadas || []).includes(op);
              const isNega = op === 'Nega';
              return `<button type="button" class="chip-btn ${isNega ? 'chip-nega' : ''} ${sel ? 'selected' : ''}" data-alergia-chip="${escapeHtml(op)}">${escapeHtml(op)}</button>`;
            }).join('')}
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>Outra(s) Alergia(s) não listada(s) (escrever)</label>
            <input type="text" id="inp-alergia-outro" placeholder="Escreva aqui se houver outra alergia..." data-f="alergiasOutro" value="${escapeHtml(d.alergiasOutro || '')}" />
          </div>
        </div>
      `;
    } else if (fichaStep === 5) {
      const procsFlat = window.SAMU_SCHEMA.procedimentosGrid.flat().filter(x => x !== '__OUTRO__');
      stepHtml = `
        <div class="card">
          <div class="card-title"><span>🩹 Procedimentos, Conduta &amp; Relatório</span></div>
          <div class="section-subtitle">Procedimentos Realizados</div>
          <div class="chips-wrap" style="margin-bottom:10px;">
            ${procsFlat.map(pr => `
              <button type="button" class="chip-btn ${(d.procedimentos || []).includes(pr) ? 'selected' : ''}" data-arr="procedimentos" data-val="${escapeHtml(pr)}">${pr}</button>
            `).join('')}
          </div>
          <div class="field">
            <label>Outro Procedimento (opcional)</label>
            <input type="text" placeholder="Se outro procedimento..." data-f="procOutroTexto" value="${escapeHtml(d.procOutroTexto)}" />
          </div>

          <div class="field">
            <label>Conduta</label>
            <textarea rows="2" placeholder="Conduta orientada / encaminhamento..." data-f="conduta">${escapeHtml(d.conduta)}</textarea>
          </div>
          <div class="field">
            <label>Médico Regulador</label>
            <input type="text" placeholder="Dr(a). Nome / Senha de regulação" data-f="medicoRegulador" value="${escapeHtml(d.medicoRegulador)}" />
          </div>
          <div class="field">
            <label>Descrição dos Pertences do Paciente (Deixados no Destino)</label>
            <textarea rows="2" placeholder="Ex: Documentos pessoais, celular entregue à enfermagem/familiar..." data-f="pertences">${escapeHtml(d.pertences)}</textarea>
          </div>

          <div class="field" style="margin-top:12px;">
            <label>Relatório de Enfermagem (Página 2 – Verso Pautado)</label>
            <textarea rows="10" placeholder="Evolução completa de enfermagem, sinais, intercorrências durante o transporte, entrega no destino..." data-f="relatorioEnfermagem">${escapeHtml(d.relatorioEnfermagem)}</textarea>
          </div>
        </div>
      `;
    } else if (fichaStep === 6) {
      stepHtml = `
        <div class="card">
          <div class="card-title">
            <span>✍️ Termo (Recusa / Comparecimento / Alta Local)</span>
            <button type="button" class="btn btn-outline btn-sm" id="btn-pull-vitima-termo">Puxar Nome/CPF Vítima</button>
          </div>
          <p style="margin:0 0 10px; font-size:0.83rem; color:var(--muted);">
            Marque apenas se houver Recusa de Atendimento, Confirmação de Comparecimento sem vítima ou Alta no Local:
          </p>
          <div class="chips-wrap" style="margin-bottom:12px;">
            <button type="button" class="chip-btn ${(d.termosSelecionados || []).includes('RECUSA') ? 'selected' : ''}" data-arr="termosSelecionados" data-val="RECUSA">RECUSA DE ATENDIMENTO</button>
            <button type="button" class="chip-btn ${(d.termosSelecionados || []).includes('COMPARECIMENTO') ? 'selected' : ''}" data-arr="termosSelecionados" data-val="COMPARECIMENTO">CONFIRMAÇÃO DE COMPARECIMENTO</button>
            <button type="button" class="chip-btn ${(d.termosSelecionados || []).includes('ALTA_LOCAL') ? 'selected' : ''}" data-arr="termosSelecionados" data-val="ALTA_LOCAL">ALTA LOCAL</button>
          </div>
          <div class="grid-2">
            <div class="field">
              <label>Nome Completo do Assinante</label>
              <input type="text" id="inp-termo-nome" data-f="termoNome" value="${escapeHtml(d.termoNome)}" />
            </div>
            <div class="field">
              <label>CPF do Assinante</label>
              <input type="text" id="inp-termo-cpf" inputmode="numeric" data-f="termoCpf" value="${escapeHtml(d.termoCpf)}" />
            </div>
          </div>
          <div class="field">
            <label>Assinatura na Tela (Paciente / Responsável / Testemunha)</label>
            <div class="sig-preview-box ${d.sigTermo ? 'signed' : ''}" data-sig-target="sigTermo" data-sig-title="Assinatura do Termo (Recusa / Comparecimento / Alta Local)">
              ${d.sigTermo ? `<img src="${d.sigTermo}" alt="Assinatura Termo" /><small style="color:var(--success);font-weight:700;">Toque para refazer assinatura</small>` : `<span>✍️ Toque aqui para assinar na tela com o dedo</span>`}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title"><span>🏥 Admissão Hospitalar &amp; Assinaturas Finais</span></div>
          <div class="grid-2">
            <div>
              <div class="section-subtitle" style="margin-top:0;">Setor Recomendado (SAMU)</div>
              <div class="chips-wrap">
                ${window.SAMU_SCHEMA.setoresHospital.map(s => `
                  <button type="button" class="chip-btn ${(d.setorRecomendado || []).includes(s) ? 'selected' : ''}" data-arr="setorRecomendado" data-val="${escapeHtml(s)}">${s}</button>
                `).join('')}
              </div>
            </div>
            <div>
              <div class="section-subtitle" style="margin-top:0;">Setor Admitido (Hospital)</div>
              <div class="chips-wrap">
                ${window.SAMU_SCHEMA.setoresHospital.map(s => `
                  <button type="button" class="chip-btn ${(d.setorAdmitido || []).includes(s) ? 'selected' : ''}" data-arr="setorAdmitido" data-val="${escapeHtml(s)}">${s}</button>
                `).join('')}
              </div>
            </div>
          </div>

          <div class="field" style="margin-top:10px;">
            <label>Observações (OBS)</label>
            <textarea rows="2" data-f="obsHospital" placeholder="Observações de entrega...">${escapeHtml(d.obsHospital)}</textarea>
          </div>

          <div class="field">
            <label>Destino (Hospital / Unidade)</label>
            ${(() => {
              const defHosp = (window.SamuStorage.getSettings().defaultHospital || 'HBSA').trim() || 'HBSA';
              const isDefHosp = String(d.destino || '').trim().toUpperCase() === defHosp.toUpperCase();
              return `
                <div class="chips-wrap" style="margin-bottom:7px;">
                  <button type="button" class="chip-btn ${isDefHosp ? 'selected' : ''}" id="btn-destino-hbsa">🏥 ${escapeHtml(defHosp)} (Hospital Padrão)</button>
                  <button type="button" class="chip-btn ${!isDefHosp ? 'selected' : ''}" id="btn-destino-outro">✏️ Outro Hospital / Destino (escrever)</button>
                </div>
              `;
            })()}
            <input type="text" id="inp-ficha-destino" placeholder="Digite o hospital ou unidade de destino (Padrão: HBSA)..." data-f="destino" value="${escapeHtml(d.destino)}" />
          </div>

          <div class="grid-2" style="margin-top:12px;">
            <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
                <strong style="font-size:0.86rem; color:var(--samu-red-dark);">RECEBIDO POR (HOSPITAL)</strong>
                <small style="color:var(--muted); font-size:0.72rem; font-weight:700;">Salva automático p/ próximas fichas</small>
              </div>
              ${(() => {
                const savedReceivers = window.SamuStorage.getHospitalReceivers();
                return `
                  <div class="receiver-saved-box">
                    <div style="font-size:0.76rem; font-weight:800; color:#334155;">
                      ⚡ Recebedores salvos (${savedReceivers.length}) — toque no nome p/ preencher e só assinar:
                    </div>
                    ${savedReceivers.length > 0 ? `
                      <div class="receiver-chip-wrap">
                        ${savedReceivers.map(r => {
                          const isSel = String(d.recebidoPorNome || '').trim().toLowerCase() === String(r.nome || '').trim().toLowerCase();
                          return `
                            <span class="receiver-chip ${isSel ? 'active' : ''}" data-pick-receiver="${escapeHtml(r.id)}" title="Toque para preencher Nome + COREN/CRM e abrir assinatura">
                              <span>👤 ${escapeHtml(r.nome)}${r.corenCrm ? ` • ${escapeHtml(r.corenCrm)}` : ''}</span>
                              <button type="button" class="receiver-chip-del" data-del-receiver="${escapeHtml(r.id)}" title="Remover da lista">×</button>
                            </span>
                          `;
                        }).join('')}
                      </div>
                    ` : `
                      <div style="font-size:0.75rem; color:var(--muted); margin-top:4px;">
                        Nenhum recebedor salvo ainda. Ao preencher Nome e COREN/CRM abaixo, ficará salvo automaticamente para só assinar nas próximas vezes!
                      </div>
                    `}
                  </div>
                `;
              })()}
              <div class="field" style="margin-top:6px;">
                <label>Nome do Profissional</label>
                <input type="text" id="inp-recebido-nome" placeholder="Quem recebeu o paciente no hospital" data-f="recebidoPorNome" value="${escapeHtml(d.recebidoPorNome)}" />
              </div>
              <div class="field">
                <label>COREN / CRM</label>
                <div class="input-action-row">
                  <input type="text" id="inp-recebido-coren" placeholder="COREN ou CRM" data-f="recebidoCorenCrm" value="${escapeHtml(d.recebidoCorenCrm)}" />
                  <button type="button" class="btn-lookup" id="btn-save-receiver-now" title="Salvar este Nome e COREN/CRM na lista rápida agora">💾 Salvar</button>
                </div>
              </div>
              <div class="sig-preview-box ${d.sigRecebido ? 'signed' : ''}" data-sig-target="sigRecebido" data-sig-title="Assinatura – Recebido Por (Hospital)">
                ${d.sigRecebido ? `<img src="${d.sigRecebido}" alt="Assinatura Hospital" />` : `<span>✍️ Assinar (Hospital)</span>`}
              </div>
            </div>

            <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
                <strong style="font-size:0.86rem; color:var(--samu-red-dark);">ENFERMAGEM (SAMU)</strong>
                ${(currentUser && currentUser.role === 'enfermagem' && d.enfermagemCoren)
                  ? `<small style="color:#15803d; font-size:0.73rem; font-weight:800;">✅ COREN do login</small>`
                  : ((currentUser && currentUser.role === 'enfermagem' && (currentUser.coren || currentUser.councilId))
                      ? `<button type="button" class="btn btn-outline btn-sm" id="btn-fill-my-coren" style="padding:2px 8px; font-size:0.72rem;">🔄 Usar meu COREN</button>`
                      : '')}
              </div>
              <div class="field" style="margin-top:8px;">
                <label>Nome Enfermagem SAMU</label>
                <input type="text" data-f="enfermagemNome" value="${escapeHtml(d.enfermagemNome)}" />
              </div>
              <div class="field">
                <label>COREN</label>
                <input type="text" data-f="enfermagemCoren" placeholder="Ex: COREN-SP 000000" value="${escapeHtml(d.enfermagemCoren)}" />
              </div>
              <div class="sig-preview-box ${d.sigEnfermagem ? 'signed' : ''}" data-sig-target="sigEnfermagem" data-sig-personal="1" data-sig-title="Assinatura – Enfermagem (SAMU)">
                ${d.sigEnfermagem ? `<img src="${d.sigEnfermagem}" alt="Assinatura Enfermagem" />` : `<span>✍️ Assinar (Enfermagem)</span>`}
              </div>
            </div>
          </div>

          <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px; margin-top:12px;">
            <strong style="font-size:0.86rem; color:var(--samu-red-dark);">CONDUTOR SOCORRISTA (SAMU)</strong>
            <div class="field" style="margin-top:8px;">
              <label>Nome do Condutor Socorrista</label>
              <input type="text" data-f="condutorNome" value="${escapeHtml(d.condutorNome)}" />
            </div>
            <div class="sig-preview-box ${d.sigCondutor ? 'signed' : ''}" data-sig-target="sigCondutor" data-sig-personal="1" data-sig-title="Assinatura – Condutor Socorrista (SAMU)">
              ${d.sigCondutor ? `<img src="${d.sigCondutor}" alt="Assinatura Condutor" />` : `<span>✍️ Assinar (Condutor Socorrista)</span>`}
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;">
        <div>
          <strong style="font-size:1.05rem;">${editingFichaId ? '✏️ Editando Ficha / Rascunho' : '📋 Ficha de Atendimento USB'}</strong>
          <div style="font-size:0.78rem; color:var(--muted);">${editingFichaId ? 'Alterações salvas nesta ocorrência' : 'Auto-salvamento ativo • Use os botões abaixo p/ múltiplas ocorrências'}</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-reset-ficha">
          ${editingFichaId ? '➕ Nova em Branco' : '🗑️ Limpar Ficha'}
        </button>
      </div>

      ${renderQuickDraftBarHtml('ficha')}

      <div class="step-pills">
        ${steps.map(s => `
          <button type="button" class="step-pill ${fichaStep === s.n ? 'active' : ''}" data-step="${s.n}">${s.label}</button>
        `).join('')}
      </div>

      ${stepHtml}

      <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:10px;">
        <button type="button" class="btn btn-outline" id="btn-prev-step" ${fichaStep === 1 ? 'disabled style="opacity:0.4"' : ''}>⬅️ Etapa Anterior</button>
        <button type="button" class="btn btn-outline" id="btn-next-step" ${fichaStep === 6 ? 'disabled style="opacity:0.4"' : ''}>Próxima Etapa ➡️</button>
      </div>

      <div class="sticky-form-actions">
        <button type="button" class="btn btn-secondary js-btn-save-draft" data-draft-kind="ficha">📌 Salvar Rascunho</button>
        <button type="button" class="btn btn-whatsapp js-btn-send-regulacao">📲 Cabeçalho p/ Regulação (WhatsApp)</button>
        <button type="button" class="btn btn-orange" id="btn-preview-ficha">👁️ Visualizar Ficha Oficial (PDF)</button>
        <button type="button" class="btn btn-success" id="btn-save-send-ficha">💾 Salvar e Enviar PDF ao Google Drive</button>
      </div>
    `;

    bindFichaEvents(container);
  }

  function bindFichaEvents(container) {
    bindQuickDraftBarEvents(container);

    container.querySelectorAll('.step-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        fichaStep = Number(btn.dataset.step);
        renderFichaView();
      });
    });

    const prevBtn = document.getElementById('btn-prev-step');
    const nextBtn = document.getElementById('btn-next-step');
    if (prevBtn) prevBtn.addEventListener('click', () => { if (fichaStep > 1) { fichaStep--; renderFichaView(); window.scrollTo(0, 0); } });
    if (nextBtn) nextBtn.addEventListener('click', () => { if (fichaStep < 6) { fichaStep++; renderFichaView(); window.scrollTo(0, 0); } });

    document.getElementById('btn-reset-ficha').addEventListener('click', async () => {
      if (!(await samuConfirm(editingFichaId ? 'Sair desta ficha e abrir uma nova ficha em branco (com o último KM Final)?' : 'Limpar todos os campos desta ficha em andamento?'))) return;
      if (fichaState.kmFinal && String(fichaState.kmFinal).trim() !== '') {
        window.SamuStorage.setLastKmFinal(fichaState.kmFinal);
      }
      editingFichaId = null;
      fichaState = createEmptyFicha();
      fichaStep = 1;
      await window.SamuStorage.clearDraft(currentUser.username, 'ficha');
      renderFichaView();
    });

    const useLastKmBtn = document.getElementById('btn-use-last-km');
    if (useLastKmBtn) {
      useLastKmBtn.addEventListener('click', () => {
        const lk = window.SamuStorage.getLastKmFinal();
        if (lk) {
          fichaState.kmInicial = lk;
          const kmInp = document.getElementById('inp-km-inicial');
          if (kmInp) kmInp.value = lk;
          persistFichaDraft();
          showToast(`KM Inicial preenchido com ${lk}!`);
        }
      });
    }

    const kmFinalInp = document.getElementById('inp-km-final');
    if (kmFinalInp) {
      kmFinalInp.addEventListener('change', () => {
        if (kmFinalInp.value && kmFinalInp.value.trim() !== '') {
          window.SamuStorage.setLastKmFinal(kmFinalInp.value.trim());
        }
      });
    }

    //Funções auxiliares de consulta online de CEP e CPF (em Wi-Fi / 4G)
    const executeCepLookup = async (mode, manualClick) => {
      const isOcc = mode === 'occ';
      const inp = document.getElementById(isOcc ? 'inp-occ-cep' : 'inp-vitima-cep');
      const btn = document.getElementById(isOcc ? 'btn-lookup-occ-cep' : 'btn-lookup-vit-cep');
      const hint = document.getElementById(isOcc ? 'occ-cep-hint' : 'cep-lookup-hint');
      if (!inp) return;
      const digits = String(inp.value || '').replace(/\D+/g, '');
      if (digits.length !== 8) {
        if (manualClick && hint) hint.innerHTML = '<span class="hint-warn">⚠️ Digite os 8 números do CEP.</span>';
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
      if (hint) hint.innerHTML = '<span style="color:var(--muted);">🌐 Buscando CEP online...</span>';
      try {
        const res = await window.SamuStorage.lookupCepOnline(digits);
        if (isOcc) {
          fichaState.ocorrenciaCep = res.cep;
          inp.value = res.cep;
          if (res.endereco) {
            fichaState.ocorrenciaEndereco = res.endereco;
            const endEl = document.getElementById('inp-occ-end');
            if (endEl) endEl.value = res.endereco;
          }
          if (res.bairro && !fichaState.ocorrenciaReferencia) {
            fichaState.ocorrenciaReferencia = 'Bairro ' + res.bairro;
            const refEl = document.getElementById('inp-occ-ref');
            if (refEl) refEl.value = fichaState.ocorrenciaReferencia;
          }
          persistFichaDraft();
          if (hint) {
            hint.innerHTML = res.endereco
              ? `<span class="hint-ok">✅ ${escapeHtml(res.endereco)} (${escapeHtml(res.cidade)}-${escapeHtml(res.uf)})</span>`
              : `<span class="hint-ok">✅ CEP geral de ${escapeHtml(res.cidade)}-${escapeHtml(res.uf)} confirmado! Digite a rua.</span>`;
          }
          const numEl = document.getElementById('inp-occ-num');
          if (res.endereco && numEl) numEl.focus();
        } else {
          fichaState.vitimaCep = res.cep;
          inp.value = res.cep;
          if (res.cidade) {
            fichaState.vitimaCidade = res.cidade;
            const cidEl = document.getElementById('inp-vitima-cidade');
            if (cidEl) cidEl.value = res.cidade;
          }
          if (res.bairro) {
            fichaState.vitimaBairro = res.bairro;
            const baiEl = document.getElementById('inp-vitima-bairro');
            if (baiEl) baiEl.value = res.bairro;
          }
          if (res.endereco) {
            fichaState.vitimaEndereco = res.endereco;
            const endEl = document.getElementById('inp-vitima-end');
            if (endEl) endEl.value = res.endereco;
          }
          persistFichaDraft();
          if (hint) {
            hint.innerHTML = res.endereco
              ? `<span class="hint-ok">✅ Endereço puxado: ${escapeHtml(res.endereco)}</span>`
              : `<span class="hint-ok">✅ CEP único de ${escapeHtml(res.cidade)}-${escapeHtml(res.uf)}. Informe o bairro e rua.</span>`;
          }
          const numEl = document.getElementById('inp-vitima-num');
          if (res.endereco && numEl) numEl.focus();
        }
      } catch (err) {
        if (hint) hint.innerHTML = `<span class="hint-warn">⚠️ ${escapeHtml(err.message || 'Não foi possível puxar o CEP.')}</span>`;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔍 CEP'; }
      }
    };

    const executeCpfLookup = async (manualClick) => {
      const inp = document.getElementById('inp-vitima-cpf');
      const btn = document.getElementById('btn-lookup-cpf');
      const hint = document.getElementById('cpf-lookup-hint');
      if (!inp) return;
      const digits = String(inp.value || '').replace(/\D+/g, '');
      if (digits.length !== 11) {
        if (manualClick && hint) hint.innerHTML = '<span class="hint-warn">⚠️ Digite os 11 números do CPF.</span>';
        return;
      }
      if (!window.SamuStorage.isValidCpf(digits)) {
        if (hint) hint.innerHTML = '<span class="hint-err">⚠️ CPF com dígito verificador inválido. Confira os números.</span>';
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
      if (hint) hint.innerHTML = '<span style="color:var(--muted);">🔎 Buscando cadastro pelo CPF...</span>';
      try {
        const res = await window.SamuStorage.lookupPatientByCpf(digits);
        if (res && res.patient) {
          const p = res.patient;
          const applyField = (stateKey, elId, val) => {
            if (val && String(val).trim() !== '') {
              fichaState[stateKey] = val;
              const el = elId ? document.getElementById(elId) : null;
              if (el) el.value = val;
            }
          };
          applyField('vitimaNome', 'inp-vitima-nome', p.vitimaNome);
          applyField('vitimaDn', 'inp-vitima-dn', p.vitimaDn);
          const calcAge = p.vitimaDn ? calcAgeFromDn(p.vitimaDn) : '';
          applyField('vitimaIdade', 'inp-vitima-idade', calcAge || p.vitimaIdade);
          applyField('vitimaRg', 'inp-vitima-rg', p.vitimaRg);
          applyField('vitimaCns', 'inp-vitima-cns', p.vitimaCns);
          applyField('vitimaCep', 'inp-vitima-cep', p.vitimaCep);
          applyField('vitimaCidade', 'inp-vitima-cidade', p.vitimaCidade);
          applyField('vitimaBairro', 'inp-vitima-bairro', p.vitimaBairro);
          applyField('vitimaEndereco', 'inp-vitima-end', p.vitimaEndereco);
          applyField('vitimaNumero', 'inp-vitima-num', p.vitimaNumero);
          applyField('vitimaNaturalidade', 'inp-vitima-nat', p.vitimaNaturalidade);
          applyField('vitimaPai', 'inp-vitima-pai', p.vitimaPai);
          applyField('vitimaMae', 'inp-vitima-mae', p.vitimaMae);

          // Se antecedentes / medicamentos / alergias ainda estiverem em branco nesta ficha, aproveita o histórico do paciente
          if ((!fichaState.antecedentes || fichaState.antecedentes.length === 0) && Array.isArray(p.antecedentes) && p.antecedentes.length > 0) {
            fichaState.antecedentes = p.antecedentes.slice();
          }
          if ((!fichaState.medicamentosSelecionados || fichaState.medicamentosSelecionados.length === 0) && Array.isArray(p.medicamentosSelecionados) && p.medicamentosSelecionados.length > 0) {
            fichaState.medicamentosSelecionados = p.medicamentosSelecionados.slice();
          }
          if (!fichaState.medicamentosOutro && p.medicamentosOutro) {
            fichaState.medicamentosOutro = p.medicamentosOutro;
          }
          if ((!fichaState.alergiasSelecionadas || fichaState.alergiasSelecionadas.length === 0) && Array.isArray(p.alergiasSelecionadas) && p.alergiasSelecionadas.length > 0) {
            fichaState.alergiasSelecionadas = p.alergiasSelecionadas.slice();
          }
          if (!fichaState.alergiasOutro && p.alergiasOutro) {
            fichaState.alergiasOutro = p.alergiasOutro;
          }

          persistFichaDraft();
          const srcLabel = res.source === 'samu_cloud' ? 'Base SAMU Drive' : (res.source === 'external_api' ? 'Consulta Online' : 'Histórico do Aparelho');
          if (hint) hint.innerHTML = `<span class="hint-ok">✅ Cadastro puxado automaticamente (${srcLabel})!</span>`;
          showToast(`✅ Paciente encontrado: ${p.vitimaNome || 'Dados preenchidos'}!`);
        } else {
          if (hint) {
            hint.innerHTML = navigator.onLine
              ? '<span class="hint-ok">✅ CPF válido (1º atendimento na base — preencha para ficar salvo nos próximos).</span>'
              : '<span class="hint-ok">✅ CPF válido (offline — sem cadastro salvo neste aparelho).</span>';
          }
          if (manualClick) showToast('CPF válido, ainda sem atendimento anterior salvo na base.');
        }
      } catch (err) {
        if (hint) hint.innerHTML = `<span class="hint-warn">⚠️ ${escapeHtml(err.message || 'Erro ao consultar CPF.')}</span>`;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔍 CPF'; }
      }
    };

    const btnOccCep = document.getElementById('btn-lookup-occ-cep');
    if (btnOccCep) btnOccCep.addEventListener('click', () => executeCepLookup('occ', true));

    const btnVitCep = document.getElementById('btn-lookup-vit-cep');
    if (btnVitCep) btnVitCep.addEventListener('click', () => executeCepLookup('vitima', true));

    const btnCpfLookup = document.getElementById('btn-lookup-cpf');
    if (btnCpfLookup) btnCpfLookup.addEventListener('click', () => executeCpfLookup(true));

    // Inputs simples
    container.querySelectorAll('[data-f]').forEach(inp => {
      inp.addEventListener('input', () => {
        const key = inp.dataset.f;
        let val = inp.value;

        if (key === 'ocorrenciaCep' || key === 'vitimaCep') {
          const prevDigits = String(fichaState[key] || '').replace(/\D+/g, '');
          val = formatCep(val);
          inp.value = val;
          fichaState[key] = val;
          const curDigits = val.replace(/\D+/g, '');
          if (curDigits.length === 8 && curDigits !== prevDigits && navigator.onLine) {
            executeCepLookup(key === 'ocorrenciaCep' ? 'occ' : 'vitima', false);
          }
          persistFichaDraft();
          return;
        }

        if (key === 'vitimaCpf' || key === 'termoCpf') {
          const prevDigits = String(fichaState[key] || '').replace(/\D+/g, '');
          val = window.SamuStorage.formatCpf(val);
          inp.value = val;
          fichaState[key] = val;
          if (key === 'vitimaCpf') {
            const curDigits = val.replace(/\D+/g, '');
            const hint = document.getElementById('cpf-lookup-hint');
            if (curDigits.length < 11) {
              if (hint) hint.innerHTML = '';
            } else if (curDigits.length === 11 && curDigits !== prevDigits) {
              executeCpfLookup(false);
            }
          }
          persistFichaDraft();
          return;
        }

        fichaState[key] = val;
        if (key === 'localOutroTexto') fichaState.localOutroCheck = Boolean(val.trim());
        if (key === 'tipoOutroTexto') fichaState.tipoOutroCheck = Boolean(val.trim());
        if (key === 'situacaoOutroTexto') fichaState.situacaoOutroCheck = Boolean(val.trim());
        if (key === 'procOutroTexto') fichaState.procOutroCheck = Boolean(val.trim());

        // Se escrever outro medicamento ou outra alergia manualmente, desmarca "Nega" automaticamente
        if (key === 'medicamentosOutro' && val.trim() && Array.isArray(fichaState.medicamentosSelecionados) && fichaState.medicamentosSelecionados.includes('Nega')) {
          fichaState.medicamentosSelecionados = fichaState.medicamentosSelecionados.filter(x => x !== 'Nega');
          container.querySelectorAll('[data-med-chip="Nega"]').forEach(b => b.classList.remove('selected'));
        }
        if (key === 'alergiasOutro' && val.trim() && Array.isArray(fichaState.alergiasSelecionadas) && fichaState.alergiasSelecionadas.includes('Nega')) {
          fichaState.alergiasSelecionadas = fichaState.alergiasSelecionadas.filter(x => x !== 'Nega');
          container.querySelectorAll('[data-alergia-chip="Nega"]').forEach(b => b.classList.remove('selected'));
        }

        // Cálculo automático de idade ao preencher DN
        if (key === 'vitimaDn' && val) {
          const calc = calcAgeFromDn(val);
          if (calc) {
            fichaState.vitimaIdade = calc;
            const ageEl = document.getElementById('inp-vitima-idade');
            if (ageEl) ageEl.value = fichaState.vitimaIdade;
          }
        }
        persistFichaDraft();
      });
    });

    // Filtro rápido da lista de medicamentos (sem perder o foco de digitação)
    const medFilterInp = document.getElementById('inp-med-filter');
    if (medFilterInp) {
      medFilterInp.addEventListener('input', () => {
        medFilterQuery = medFilterInp.value;
        const pos = medFilterInp.selectionStart;
        renderFichaView();
        const el = document.getElementById('inp-med-filter');
        if (el) {
          el.focus();
          try { el.setSelectionRange(pos, pos); } catch (e) {}
        }
      });
    }

    // Seleção de Medicamentos em Uso ("Nega" em primeiro + ordem alfabética)
    container.querySelectorAll('[data-med-chip]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.medChip;
        let cur = Array.isArray(fichaState.medicamentosSelecionados) ? fichaState.medicamentosSelecionados.slice() : [];
        if (val === 'Nega') {
          if (cur.includes('Nega')) {
            cur = [];
          } else {
            cur = ['Nega'];
            fichaState.medicamentosOutro = '';
          }
        } else {
          cur = cur.filter(x => x !== 'Nega');
          const idx = cur.indexOf(val);
          if (idx >= 0) cur.splice(idx, 1);
          else cur.push(val);
        }
        fichaState.medicamentosSelecionados = cur;
        persistFichaDraft();
        renderFichaView();
      });
    });

    // Seleção de Alergias ("Nega" em primeiro + ordem alfabética)
    container.querySelectorAll('[data-alergia-chip]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.alergiaChip;
        let cur = Array.isArray(fichaState.alergiasSelecionadas) ? fichaState.alergiasSelecionadas.slice() : [];
        if (val === 'Nega') {
          if (cur.includes('Nega')) {
            cur = [];
          } else {
            cur = ['Nega'];
            fichaState.alergiasOutro = '';
          }
        } else {
          cur = cur.filter(x => x !== 'Nega');
          const idx = cur.indexOf(val);
          if (idx >= 0) cur.splice(idx, 1);
          else cur.push(val);
        }
        fichaState.alergiasSelecionadas = cur;
        persistFichaDraft();
        renderFichaView();
      });
    });

    // Classificação de risco
    container.querySelectorAll('[data-risco]').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = btn.dataset.risco;
        fichaState.risco = (fichaState.risco === r) ? '' : r;
        persistFichaDraft();
        renderFichaView();
      });
    });

    // Arrays de multi-seleção (chips)
    container.querySelectorAll('[data-arr]').forEach(btn => {
      btn.addEventListener('click', () => {
        const arrKey = btn.dataset.arr;
        const val = btn.dataset.val;
        const cur = Array.isArray(fichaState[arrKey]) ? fichaState[arrKey].slice() : [];
        const i = cur.indexOf(val);
        if (i >= 0) cur.splice(i, 1);
        else cur.push(val);
        fichaState[arrKey] = cur;
        persistFichaDraft();
        renderFichaView();
      });
    });

    // Copiar endereço da ocorrência para vítima
    const copyAddrBtn = document.getElementById('btn-copy-occ-addr');
    if (copyAddrBtn) {
      copyAddrBtn.addEventListener('click', () => {
        fichaState.vitimaEndereco = fichaState.ocorrenciaEndereco || '';
        fichaState.vitimaNumero = fichaState.ocorrenciaNumero || '';
        persistFichaDraft();
        renderFichaView();
        showToast('Endereço copiado para os dados da vítima!');
      });
    }

    // Horários + botão AGORA
    container.querySelectorAll('[data-horario]').forEach(inp => {
      inp.addEventListener('input', () => {
        fichaState.horarios[inp.dataset.horario] = inp.value;
        persistFichaDraft();
      });
    });
    container.querySelectorAll('[data-now]').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.now;
        const t = nowHHMM();
        fichaState.horarios[k] = t;
        persistFichaDraft();
        const inp = container.querySelector(`[data-horario="${k}"]`);
        if (inp) inp.value = t;
        showToast(`Horário registrado: ${t}`);
      });
    });

    // Boneco Regra dos 9
    container.querySelectorAll('[data-burn]').forEach(btn => {
      btn.addEventListener('click', () => {
        const zId = btn.dataset.burn;
        const list = Array.isArray(fichaState.burnZonesSelected) ? fichaState.burnZonesSelected.slice() : [];
        const idx = list.indexOf(zId);
        if (idx >= 0) list.splice(idx, 1);
        else list.push(zId);
        fichaState.burnZonesSelected = list;

        let total = 0;
        window.SAMU_SCHEMA.burnZones.forEach(z => {
          if (list.includes(z.id)) total += z.pct;
        });
        if (total > 0) {
          fichaState.haQueimaduras = 'SIM';
          fichaState.queimadurasPorcentagem = String(total).replace('.', ',') + '%';
        } else {
          fichaState.haQueimaduras = 'NAO';
          fichaState.queimadurasPorcentagem = '';
        }
        persistFichaDraft();
        renderFichaView();
      });
    });

    const clearBurns = document.getElementById('btn-clear-burns');
    if (clearBurns) {
      clearBurns.addEventListener('click', () => {
        fichaState.burnZonesSelected = [];
        fichaState.haQueimaduras = 'NAO';
        fichaState.queimadurasPorcentagem = '';
        persistFichaDraft();
        renderFichaView();
      });
    }

    // Botões SIM / NÃO Avaliação Primária & Pupilas
    container.querySelectorAll('[data-yn]').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.yn;
        const v = btn.dataset.val;
        fichaState[k] = (fichaState[k] === v) ? '' : v;
        persistFichaDraft();
        renderFichaView();
      });
    });

    const avAllYes = document.getElementById('btn-av-all-yes');
    if (avAllYes) {
      avAllYes.addEventListener('click', () => {
        fichaState.viaAerea = 'SIM';
        fichaState.respiracao = 'SIM';
        fichaState.circulacao = 'SIM';
        fichaState.consciente = 'SIM';
        persistFichaDraft();
        renderFichaView();
      });
    }

    container.querySelectorAll('[data-pupil]').forEach(card => {
      card.addEventListener('click', () => {
        const k = card.dataset.pupil;
        const v = card.dataset.val;
        fichaState[k] = (fichaState[k] === v) ? '' : v;
        persistFichaDraft();
        renderFichaView();
      });
    });

    const pupNormBtn = document.getElementById('btn-pupilas-normais');
    if (pupNormBtn) {
      pupNormBtn.addEventListener('click', () => {
        fichaState.pupilaDirTamanho = 'MEDIA';
        fichaState.pupilaEsqTamanho = 'MEDIA';
        fichaState.pupilaDirReativa = 'SIM';
        fichaState.pupilaEsqReativa = 'SIM';
        persistFichaDraft();
        renderFichaView();
      });
    }

    const pullVitBtn = document.getElementById('btn-pull-vitima-termo');
    if (pullVitBtn) {
      pullVitBtn.addEventListener('click', () => {
        fichaState.termoNome = fichaState.vitimaNome || '';
        fichaState.termoCpf = fichaState.vitimaCpf || '';
        persistFichaDraft();
        renderFichaView();
      });
    }

    // Etapa 6: Hospital padrão HBSA vs Outro Destino
    const btnDestHbsa = document.getElementById('btn-destino-hbsa');
    const btnDestOutro = document.getElementById('btn-destino-outro');
    const inpFichaDestino = document.getElementById('inp-ficha-destino');
    if (btnDestHbsa) {
      btnDestHbsa.addEventListener('click', () => {
        const defHosp = (window.SamuStorage.getSettings().defaultHospital || 'HBSA').trim() || 'HBSA';
        fichaState.destino = defHosp;
        persistFichaDraft();
        renderFichaView();
        showToast(`🏥 Destino definido como ${defHosp}.`);
      });
    }
    if (btnDestOutro) {
      btnDestOutro.addEventListener('click', () => {
        const defHosp = (window.SamuStorage.getSettings().defaultHospital || 'HBSA').trim() || 'HBSA';
        if (String(fichaState.destino || '').trim().toUpperCase() === defHosp.toUpperCase()) {
          fichaState.destino = '';
          persistFichaDraft();
          if (inpFichaDestino) inpFichaDestino.value = '';
        }
        if (btnDestHbsa) btnDestHbsa.classList.remove('selected');
        btnDestOutro.classList.add('selected');
        if (inpFichaDestino) inpFichaDestino.focus();
      });
    }
    if (inpFichaDestino) {
      inpFichaDestino.addEventListener('input', () => {
        const defHosp = (window.SamuStorage.getSettings().defaultHospital || 'HBSA').trim() || 'HBSA';
        const isDef = String(inpFichaDestino.value || '').trim().toUpperCase() === defHosp.toUpperCase();
        if (btnDestHbsa) btnDestHbsa.classList.toggle('selected', isDef);
        if (btnDestOutro) btnDestOutro.classList.toggle('selected', !isDef);
      });
    }

    // Etapa 6: Reaplicar COREN do Técnico logado caso tenha apagado
    const btnFillMyCoren = document.getElementById('btn-fill-my-coren');
    if (btnFillMyCoren) {
      btnFillMyCoren.addEventListener('click', () => {
        if (currentUser) {
          fichaState.enfermagemNome = currentUser.name || fichaState.enfermagemNome;
          fichaState.enfermagemCoren = currentUser.coren || currentUser.councilId || '';
          persistFichaDraft();
          renderFichaView();
          showToast('✅ Nome e COREN preenchidos pelo seu login!');
        }
      });
    }

    // Etapa 6: Recebedores salvos do Hospital (1 toque preenche Nome + COREN/CRM e abre Assinatura!)
    const btnSaveReceiverNow = document.getElementById('btn-save-receiver-now');
    if (btnSaveReceiverNow) {
      btnSaveReceiverNow.addEventListener('click', () => {
        const nome = String(fichaState.recebidoPorNome || '').trim();
        const corenCrm = String(fichaState.recebidoCorenCrm || '').trim();
        if (!nome) {
          samuAlert('Digite o Nome de quem recebeu no hospital para salvar na lista rápida.');
          return;
        }
        window.SamuStorage.upsertHospitalReceiver({
          nome,
          corenCrm,
          hospital: fichaState.destino || 'HBSA'
        });
        persistFichaDraft();
        renderFichaView();
        showToast(`✅ ${nome} salvo! Nas próximas fichas é só tocar no nome e assinar.`);
      });
    }

    container.querySelectorAll('[data-del-receiver]').forEach(delBtn => {
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const recId = delBtn.dataset.delReceiver;
        if (!(await samuConfirm('Remover este profissional da lista rápida do hospital?'))) return;
        window.SamuStorage.deleteHospitalReceiver(recId);
        renderFichaView();
      });
    });

    container.querySelectorAll('[data-pick-receiver]').forEach(chip => {
      chip.addEventListener('click', () => {
        const recId = chip.dataset.pickReceiver;
        const found = window.SamuStorage.getHospitalReceivers().find(r => r.id === recId);
        if (!found) return;
        const prevNome = String(fichaState.recebidoPorNome || '').trim().toLowerCase();
        if (prevNome !== String(found.nome || '').trim().toLowerCase()) {
          fichaState.sigRecebido = '';
        }
        fichaState.recebidoPorNome = found.nome;
        fichaState.recebidoCorenCrm = found.corenCrm || '';
        window.SamuStorage.upsertHospitalReceiver(found);
        persistFichaDraft();
        renderFichaView();

        // Já abre direto a tela de assinatura para o profissional do hospital só assinar!
        window.SamuSignature.open({
          title: `Assinatura – ${found.nome}${found.corenCrm ? ' (' + found.corenCrm + ')' : ''}`,
          initialValue: fichaState.sigRecebido || '',
          allowPersonalSave: false,
          username: ''
        }, (dataUrl) => {
          fichaState.sigRecebido = dataUrl;
          persistFichaDraft();
          renderFichaView();
          showToast(`✍️ Assinatura de ${found.nome} registrada!`);
        });
      });
    });

    // Quadros de Assinatura na Tela
    container.querySelectorAll('[data-sig-target]').forEach(box => {
      box.addEventListener('click', () => {
        const key = box.dataset.sigTarget;
        const allowPersonal = box.dataset.sigPersonal === '1';
        window.SamuSignature.open({
          title: box.dataset.sigTitle || 'Assinatura',
          initialValue: fichaState[key] || '',
          allowPersonalSave: allowPersonal,
          username: currentUser ? currentUser.username : ''
        }, (dataUrl) => {
          fichaState[key] = dataUrl;
          if (key === 'sigRecebido' && String(fichaState.recebidoPorNome || '').trim()) {
            window.SamuStorage.upsertHospitalReceiver({
              nome: fichaState.recebidoPorNome,
              corenCrm: fichaState.recebidoCorenCrm || '',
              hospital: fichaState.destino || 'HBSA'
            });
          }
          persistFichaDraft();
          renderFichaView();
        });
      });
    });

    // Visualizar PDF Oficial (sem finalizar ainda)
    document.getElementById('btn-preview-ficha').addEventListener('click', async () => {
      const tempRecord = buildFichaRecordObject(editingFichaId || uid('ficha'));
      await openPdfPreviewModal(tempRecord);
    });

    // Salvar e Enviar PDF ao Google Drive
    document.getElementById('btn-save-send-ficha').addEventListener('click', async () => {
      const btn = document.getElementById('btn-save-send-ficha');
      btn.disabled = true;
      btn.textContent = 'Gerando PDF e Salvando...';
      try {
        if (fichaState.kmFinal && String(fichaState.kmFinal).trim() !== '') {
          window.SamuStorage.setLastKmFinal(fichaState.kmFinal);
        }

        const recId = editingFichaId || uid('ficha');
        const existing = editingFichaId ? await window.SamuStorage.getRecordById(editingFichaId) : null;
        const record = buildFichaRecordObject(recId, existing);
        record.isDraft = false;

        const generated = await window.SamuPDF.generatePdfForRecord(record);
        await window.SamuStorage.saveRecordLocal(record);
        const upRes = await window.SamuStorage.uploadRecordToDrive(record, generated.base64);
        await window.SamuStorage.clearDraft(currentUser.username, 'ficha');

        // Prepara nova ficha limpa para o próximo atendimento (já puxando o último KM Final como KM Inicial!)
        editingFichaId = null;
        fichaState = createEmptyFicha();
        fichaStep = 1;
        await refreshDraftCount();
        await refreshSyncBadge();

        await openPdfPreviewModal(record, generated, upRes);
        renderFichaView();
      } catch (err) {
        samuAlert('Erro ao salvar ficha: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 Salvar e Enviar PDF ao Google Drive';
      }
    });
  }

  function buildFichaRecordObject(id, existing) {
    const d = JSON.parse(JSON.stringify(fichaState));
    const tipos = (d.tiposAtendimento || []).slice();
    if (d.tipoOutroTexto) tipos.push(d.tipoOutroTexto);

    return {
      id,
      type: 'ficha',
      date: d.data || todayISO(),
      createdAt: (existing && existing.createdAt) ? existing.createdAt : new Date().toISOString(),
      createdBy: (existing && existing.createdBy) ? existing.createdBy : currentUser.username,
      createdByName: (existing && existing.createdByName) ? existing.createdByName : currentUser.name,
      createdByRole: (existing && existing.createdByRole) ? existing.createdByRole : currentUser.role,
      patientName: d.vitimaNome || 'Paciente não identificado',
      patientCpf: d.vitimaCpf || '',
      risk: d.risco || '',
      incidentType: tipos.join(', ') || d.motivoSolicitacao || '',
      vehicle: 'USB',
      shift: (d.horarios && d.horarios.horaChamado) || '',
      summary: [d.ocorrenciaEndereco, d.destino ? 'Destino: ' + d.destino : ''].filter(Boolean).join(' • '),
      driveFileId: (existing && existing.driveFileId) || '',
      driveUrl: (existing && existing.driveUrl) || '',
      syncStatus: 'pending',
      data: d
    };
  }

  /* ==========================================================================
   * ABA 2: CHECK LIST – CONDUTOR / SOCORRISTA
   * ========================================================================== */
  function renderCondutorView() {
    const container = document.getElementById('main-view');
    const d = condutorState;
    const isDiurno = d.turnoAtivo === 'DIURNO';
    const itensMap = isDiurno ? d.itensDiurno : d.itensNoturno;
    const avariasArr = isDiurno ? d.avariasDiurno : d.avariasNoturno;
    const allItems = window.SAMU_SCHEMA.condutorLeftItems.concat(window.SAMU_SCHEMA.condutorRightItems);
    const filledCount = allItems.filter(it => Boolean(itensMap[it.id])).length;

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
        <div>
          <strong style="font-size:1.05rem;">🚑 Check List – Condutor / Socorrista</strong>
          <div style="font-size:0.78rem; color:var(--muted);">Conferidos no turno: ${filledCount} de ${allItems.length} itens</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-reset-condutor">🗑️ Limpar</button>
      </div>

      ${renderQuickDraftBarHtml('condutor')}

      <div class="card">
        <div class="card-title"><span>📋 Identificação do Plantão e Viatura</span></div>
        <div class="grid-2">
          <div class="field">
            <label>Data</label>
            <input type="date" id="cond-data" value="${escapeHtml(d.data)}" />
          </div>
          <div class="field">
            <label>Turno sendo Preenchido</label>
            <select id="cond-turno">
              <option value="DIURNO" ${isDiurno ? 'selected' : ''}>☀️ PLANTÃO DIURNO</option>
              <option value="NOTURNO" ${!isDiurno ? 'selected' : ''}>🌙 PLANTÃO NOTURNO</option>
            </select>
          </div>
        </div>

        <div class="section-subtitle">Selecione a Viatura</div>
        <div class="grid-2" style="margin-bottom:10px;">
          ${window.SAMU_SCHEMA.viaturas.map(v => `
            <button type="button" class="chip-btn ${d.viaturaId === v.id ? 'selected' : ''}" data-viatura="${v.id}" style="text-align:left;">
              <strong>${v.label}</strong>${v.placa ? `<br><small>Placa: ${v.placa}</small>` : ''}
            </button>
          `).join('')}
        </div>
        ${d.viaturaId === 'outra' ? `
          <div class="field">
            <label>Informe Modelo / Placa da Outra Viatura</label>
            <input type="text" id="cond-outra-placa" placeholder="Ex: Mercedes Sprinter - ABC 1D23" value="${escapeHtml(d.outraPlaca)}" />
          </div>
        ` : ''}

        <div class="grid-2">
          <div class="field">
            <label>Condutor Diurno</label>
            <input type="text" id="cond-nome-diurno" value="${escapeHtml(d.condutorDiurno)}" />
          </div>
          <div class="field">
            <label>Condutor Noturno</label>
            <input type="text" id="cond-nome-noturno" value="${escapeHtml(d.condutorNoturno)}" />
          </div>
        </div>

        <div class="section-subtitle">Abastecimento (se realizado)</div>
        <div class="grid-4">
          <div class="field"><label>Litros</label><input type="text" id="cond-abast-l" placeholder="Ex: 48 L" value="${escapeHtml(d.abastLitros)}" /></div>
          <div class="field"><label>Hora</label><input type="time" id="cond-abast-h" value="${escapeHtml(d.abastHora)}" /></div>
          <div class="field"><label>KM</label><input type="number" id="cond-abast-km" placeholder="KM" value="${escapeHtml(d.abastKm)}" /></div>
          <div class="field"><label>Responsável / Ass.</label><input type="text" id="cond-abast-ass" value="${escapeHtml(d.abastAss)}" /></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>✅ Itens da Viatura (${isDiurno ? 'Coluna Diurno' : 'Coluna Noturno'})</span>
          <button type="button" class="btn btn-success btn-sm" id="btn-cond-all-ok">✅ Marcar Todos OK</button>
        </div>
        <p style="margin:0 0 10px; font-size:0.8rem; color:var(--muted);">
          Legenda oficial: <strong>OK</strong>=Normal • <strong>A</strong>=Amassado • <strong>D</strong>=Danificado • <strong>F</strong>=Falta • <strong>Q</strong>=Queimado • <strong>R</strong>=Riscado
        </p>

        <div>
          ${allItems.map(it => {
            const cur = itensMap[it.id] || '';
            return `
              <div class="check-item-row">
                <div class="check-item-info">
                  <span class="check-item-qty">${it.qty}</span>
                  <span class="check-item-name">${it.name}</span>
                </div>
                <div class="code-pills">
                  ${['OK', 'A', 'D', 'F', 'Q', 'R'].map(code => {
                    const cls = cur === code ? (code === 'OK' ? 'active-OK' : 'active-warn') : '';
                    return `<button type="button" class="code-pill ${cls}" data-citem="${it.id}" data-code="${code}">${code}</button>`;
                  }).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>🚐 Vistoria Externa (${isDiurno ? 'Diurno' : 'Noturno'})</span>
          <button type="button" class="btn btn-outline btn-sm" id="btn-clear-avarias">Limpar Marcações</button>
        </div>
        <p style="margin:0 0 8px; font-size:0.83rem; color:var(--muted);">
          Escolha o tipo de avaria abaixo e <strong>toque em cima do desenho da ambulância</strong> onde houver detalhe (toque num ponto vermelho para removê-lo):
        </p>
        <div class="chips-wrap" style="margin-bottom:10px; justify-content:center;">
          ${['A', 'D', 'F', 'Q', 'R'].map(c => {
            const leg = window.SAMU_SCHEMA.condutorLegenda.find(l => l.code === c);
            return `<button type="button" class="chip-btn ${activeDamageCode === c ? 'selected' : ''}" data-dmg-code="${c}">${leg ? leg.label : c}</button>`;
          }).join('')}
        </div>
        <div class="amb-damage-stage" id="amb-stage">
          <img src="${(window.SAMU_ASSETS && window.SAMU_ASSETS.ambulance_diagram) || ''}" alt="Vistoria Ambulância" />
          ${(avariasArr || []).map((mk, idx) => `
            <div class="amb-pin" data-pin-idx="${idx}" style="left:${mk.x * 100}%; top:${mk.y * 100}%;" title="Toque para remover">${mk.code}</div>
          `).join('')}
        </div>

        <div class="field" style="margin-top:14px;">
          <label>Observações ${isDiurno ? 'Diurno' : 'Noturna'}</label>
          <textarea rows="4" id="cond-obs-turno" placeholder="Registre qualquer anormalidade, falta de material, avaria ou intercorrência da viatura...">${escapeHtml(isDiurno ? d.obsDiurno : d.obsNoturno)}</textarea>
        </div>

        <div class="field">
          <label>Assinatura na Tela – Condutor ${isDiurno ? 'Diurno' : 'Noturno'}</label>
          <div class="sig-preview-box ${(isDiurno ? d.sigCondutorDiurno : d.sigCondutorNoturno) ? 'signed' : ''}" id="cond-sig-box">
            ${(isDiurno ? d.sigCondutorDiurno : d.sigCondutorNoturno)
              ? `<img src="${isDiurno ? d.sigCondutorDiurno : d.sigCondutorNoturno}" alt="Assinatura Condutor" />`
              : `<span>✍️ Toque para assinar Check List (${isDiurno ? 'Diurno' : 'Noturno'})</span>`}
          </div>
        </div>
      </div>

      <div class="sticky-form-actions">
        <button type="button" class="btn btn-secondary js-btn-save-draft" data-draft-kind="condutor">📌 Salvar Rascunho</button>
        <button type="button" class="btn btn-orange" id="btn-preview-condutor">👁️ Visualizar Check List (PDF)</button>
        <button type="button" class="btn btn-success" id="btn-save-send-condutor">💾 Salvar e Enviar PDF ao Google Drive</button>
      </div>
    `;

    bindQuickDraftBarEvents(container);

    const saveCondDraft = () => {
      if (!editingCondutorId && currentUser) {
        window.SamuStorage.saveDraft(currentUser.username, 'checklist_condutor', condutorState);
      }
    };

    document.getElementById('btn-reset-condutor').addEventListener('click', async () => {
      if (!(await samuConfirm('Limpar os campos deste Check List de Condutor?'))) return;
      editingCondutorId = null;
      condutorState = createEmptyCondutor();
      await window.SamuStorage.clearDraft(currentUser.username, 'checklist_condutor');
      renderCondutorView();
    });

    document.getElementById('cond-data').addEventListener('input', e => { d.data = e.target.value; saveCondDraft(); });
    document.getElementById('cond-turno').addEventListener('change', e => {
      d.turnoAtivo = e.target.value;
      if (d.turnoAtivo === 'DIURNO' && !d.condutorDiurno && currentUser) d.condutorDiurno = currentUser.name;
      if (d.turnoAtivo === 'NOTURNO' && !d.condutorNoturno && currentUser) d.condutorNoturno = currentUser.name;
      saveCondDraft();
      renderCondutorView();
    });

    container.querySelectorAll('[data-viatura]').forEach(btn => {
      btn.addEventListener('click', () => {
        d.viaturaId = btn.dataset.viatura;
        saveCondDraft();
        renderCondutorView();
      });
    });

    const outraInp = document.getElementById('cond-outra-placa');
    if (outraInp) outraInp.addEventListener('input', e => { d.outraPlaca = e.target.value; saveCondDraft(); });

    document.getElementById('cond-nome-diurno').addEventListener('input', e => { d.condutorDiurno = e.target.value; saveCondDraft(); });
    document.getElementById('cond-nome-noturno').addEventListener('input', e => { d.condutorNoturno = e.target.value; saveCondDraft(); });
    document.getElementById('cond-abast-l').addEventListener('input', e => { d.abastLitros = e.target.value; saveCondDraft(); });
    document.getElementById('cond-abast-h').addEventListener('input', e => { d.abastHora = e.target.value; saveCondDraft(); });
    document.getElementById('cond-abast-km').addEventListener('input', e => { d.abastKm = e.target.value; saveCondDraft(); });
    document.getElementById('cond-abast-ass').addEventListener('input', e => { d.abastAss = e.target.value; saveCondDraft(); });

    document.getElementById('btn-cond-all-ok').addEventListener('click', () => {
      const target = isDiurno ? d.itensDiurno : d.itensNoturno;
      allItems.forEach(it => { if (!target[it.id]) target[it.id] = 'OK'; });
      saveCondDraft();
      renderCondutorView();
      showToast('Todos os itens em branco marcados como OK!');
    });

    container.querySelectorAll('[data-citem]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.citem;
        const code = btn.dataset.code;
        const target = isDiurno ? d.itensDiurno : d.itensNoturno;
        target[id] = (target[id] === code) ? '' : code;
        saveCondDraft();
        renderCondutorView();
      });
    });

    container.querySelectorAll('[data-dmg-code]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeDamageCode = btn.dataset.dmgCode;
        renderCondutorView();
      });
    });

    const ambStage = document.getElementById('amb-stage');
    ambStage.addEventListener('click', (e) => {
      if (e.target.dataset.pinIdx !== undefined) {
        const idx = Number(e.target.dataset.pinIdx);
        avariasArr.splice(idx, 1);
        saveCondDraft();
        renderCondutorView();
        return;
      }
      const rect = ambStage.getBoundingClientRect();
      const x = Math.max(0.03, Math.min(0.97, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0.03, Math.min(0.97, (e.clientY - rect.top) / rect.height));
      avariasArr.push({ x, y, code: activeDamageCode });
      saveCondDraft();
      renderCondutorView();
    });

    document.getElementById('btn-clear-avarias').addEventListener('click', () => {
      if (isDiurno) d.avariasDiurno = [];
      else d.avariasNoturno = [];
      saveCondDraft();
      renderCondutorView();
    });

    document.getElementById('cond-obs-turno').addEventListener('input', e => {
      if (isDiurno) d.obsDiurno = e.target.value;
      else d.obsNoturno = e.target.value;
      saveCondDraft();
    });

    document.getElementById('cond-sig-box').addEventListener('click', () => {
      window.SamuSignature.open({
        title: `Assinatura – Condutor ${isDiurno ? 'Diurno' : 'Noturno'}`,
        initialValue: isDiurno ? d.sigCondutorDiurno : d.sigCondutorNoturno,
        allowPersonalSave: true,
        username: currentUser ? currentUser.username : ''
      }, (dataUrl) => {
        if (isDiurno) d.sigCondutorDiurno = dataUrl;
        else d.sigCondutorNoturno = dataUrl;
        saveCondDraft();
        renderCondutorView();
      });
    });

    const buildCondRecord = (id, existing) => {
      const vObj = window.SAMU_SCHEMA.viaturas.find(v => v.id === d.viaturaId);
      const vLabel = d.viaturaId === 'outra' ? (d.outraPlaca || 'Outra Viatura') : (vObj ? vObj.full : 'USB');
      return {
        id,
        type: 'checklist_condutor',
        date: d.data || todayISO(),
        createdAt: (existing && existing.createdAt) || new Date().toISOString(),
        createdBy: (existing && existing.createdBy) || currentUser.username,
        createdByName: (existing && existing.createdByName) || currentUser.name,
        createdByRole: (existing && existing.createdByRole) || currentUser.role,
        patientName: '',
        patientCpf: '',
        risk: '',
        incidentType: '',
        vehicle: vLabel,
        shift: d.turnoAtivo,
        summary: `Turno ${d.turnoAtivo} • ${vLabel}`,
        driveFileId: (existing && existing.driveFileId) || '',
        driveUrl: (existing && existing.driveUrl) || '',
        syncStatus: 'pending',
        data: JSON.parse(JSON.stringify(d))
      };
    };

    document.getElementById('btn-preview-condutor').addEventListener('click', async () => {
      await openPdfPreviewModal(buildCondRecord(editingCondutorId || uid('ckcond')));
    });

    document.getElementById('btn-save-send-condutor').addEventListener('click', async () => {
      const btn = document.getElementById('btn-save-send-condutor');
      btn.disabled = true;
      btn.textContent = 'Gerando PDF e Salvando...';
      try {
        const recId = editingCondutorId || uid('ckcond');
        const existing = editingCondutorId ? await window.SamuStorage.getRecordById(editingCondutorId) : null;
        const record = buildCondRecord(recId, existing);
        const generated = await window.SamuPDF.generatePdfForRecord(record);
        await window.SamuStorage.saveRecordLocal(record);
        const upRes = await window.SamuStorage.uploadRecordToDrive(record, generated.base64);
        await window.SamuStorage.clearDraft(currentUser.username, 'checklist_condutor');

        editingCondutorId = null;
        condutorState = createEmptyCondutor();
        await refreshDraftCount();
        await refreshSyncBadge();
        await openPdfPreviewModal(record, generated, upRes);
        renderCondutorView();
      } catch (err) {
        alert('Erro ao salvar Check List: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 Salvar e Enviar PDF ao Google Drive';
      }
    });
  }

  /* ==========================================================================
   * ABA 3: CHECK LIST – ENFERMAGEM (CHECAGEM DIÁRIA USB – 10 COMPARTIMENTOS)
   * ========================================================================== */
  function renderEnfermagemView() {
    const container = document.getElementById('main-view');
    const d = enfermagemState;
    const isDia = d.turno === 'DIA';
    const targetMap = isDia ? d.itensDia : d.itensNoite;
    const sections = window.SAMU_SCHEMA.enfermagemSections;
    if (activeEnfSectionIdx >= sections.length) activeEnfSectionIdx = 0;
    const activeSec = sections[activeEnfSectionIdx];

    const totalAll = sections.reduce((acc, s) => acc + s.items.length, 0);
    const doneAll = sections.reduce((acc, s) => acc + s.items.filter(i => Boolean(targetMap[i.id])).length, 0);

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
        <div>
          <strong style="font-size:1.05rem;">🩺 Checagem Diária USB – Enfermagem</strong>
          <div style="font-size:0.78rem; color:var(--muted);">Total conferido (${isDia ? 'CK DIA' : 'CK NOITE'}): ${doneAll} de ${totalAll} materiais</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button type="button" class="btn btn-success btn-sm" id="btn-enf-all-ok">✅ Tudo OK</button>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-reset-enf">🗑️ Limpar</button>
        </div>
      </div>

      ${renderQuickDraftBarHtml('enfermagem')}

      <div class="card">
        <div class="grid-4">
          <div class="field">
            <label>Data</label>
            <input type="date" id="enf-data" value="${escapeHtml(d.data)}" />
          </div>
          <div class="field">
            <label>Turno</label>
            <select id="enf-turno">
              <option value="DIA" ${isDia ? 'selected' : ''}>☀️ CK DIA</option>
              <option value="NOITE" ${!isDia ? 'selected' : ''}>🌙 CK NOITE</option>
            </select>
          </div>
          <div class="field">
            <label>Profissional Enfermagem</label>
            <input type="text" id="enf-nome" value="${escapeHtml(d.responsavelNome)}" />
          </div>
          <div class="field">
            <label>COREN</label>
            <input type="text" id="enf-coren" value="${escapeHtml(d.responsavelCoren)}" />
          </div>
        </div>
      </div>

      <div class="step-pills">
        ${sections.map((sec, idx) => {
          const secDone = sec.items.filter(it => Boolean(targetMap[it.id])).length;
          return `<button type="button" class="step-pill ${idx === activeEnfSectionIdx ? 'active' : ''}" data-enf-sec="${idx}">
            ${sec.title} (${secDone}/${sec.items.length})
          </button>`;
        }).join('')}
      </div>

      <div class="card">
        <div class="card-title">
          <span style="color:${activeSec.color};">🎒 ${activeSec.title}</span>
          <button type="button" class="btn btn-success btn-sm" id="btn-sec-ok">✅ Marcar Seção OK</button>
        </div>

        <div>
          ${activeSec.items.map(it => {
            const val = targetMap[it.id] || '';
            return `
              <div class="check-item-row">
                <div class="check-item-info">
                  <span class="check-item-qty">Qtd: ${it.qty}</span>
                  <span class="check-item-name">${it.name}</span>
                </div>
                <div class="code-pills" style="align-items:center;">
                  ${it.customInput ? `
                    <input type="text" data-enf-custom="${it.id}" placeholder="${it.placeholder || 'Libras'}"
                      value="${escapeHtml(val)}"
                      style="width:92px; padding:6px 8px; border:1.5px solid var(--border); border-radius:7px; font-weight:700; font-size:0.84rem;" />
                  ` : ''}
                  <button type="button" class="code-pill ${val === 'OK' ? 'active-OK' : ''}" data-enf-item="${it.id}" data-val="OK">OK</button>
                  <button type="button" class="code-pill ${val === 'F' ? 'active-warn' : ''}" data-enf-item="${it.id}" data-val="F">FALTA</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <div style="display:flex; justify-content:space-between; margin-top:12px;">
          <button type="button" class="btn btn-outline btn-sm" id="btn-enf-prev" ${activeEnfSectionIdx === 0 ? 'disabled style="opacity:0.4"' : ''}>⬅️ Compartimento Anterior</button>
          <button type="button" class="btn btn-outline btn-sm" id="btn-enf-next" ${activeEnfSectionIdx === sections.length - 1 ? 'disabled style="opacity:0.4"' : ''}>Próximo Compartimento ➡️</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span>📝 Observações &amp; Assinatura da Enfermagem</span></div>
        <div class="grid-2">
          <div class="field">
            <label>OBS – Mochilas (Página 1)</label>
            <textarea rows="3" id="enf-obs-1" placeholder="Reposições realizadas, lacres, validade...">${escapeHtml(d.obsPagina1)}</textarea>
          </div>
          <div class="field">
            <label>OBS – Viatura / Gavetas / Armário (Página 2)</label>
            <textarea rows="3" id="enf-obs-2" placeholder="Observações dos materiais internos da USB...">${escapeHtml(d.obsPagina2)}</textarea>
          </div>
        </div>
        <div class="field">
          <label>Assinatura e Carimbo Digital na Tela</label>
          <div class="sig-preview-box ${d.sigEnfermagem ? 'signed' : ''}" id="enf-sig-box">
            ${d.sigEnfermagem
              ? `<img src="${d.sigEnfermagem}" alt="Assinatura Enfermagem" />`
              : `<span>✍️ Toque aqui para assinar o Check List de Enfermagem</span>`}
          </div>
        </div>
      </div>

      <div class="sticky-form-actions">
        <button type="button" class="btn btn-secondary js-btn-save-draft" data-draft-kind="enfermagem">📌 Salvar Rascunho</button>
        <button type="button" class="btn btn-orange" id="btn-preview-enf">👁️ Visualizar Check List (PDF 2 Págs)</button>
        <button type="button" class="btn btn-success" id="btn-save-send-enf">💾 Salvar e Enviar PDF ao Google Drive</button>
      </div>
    `;

    bindQuickDraftBarEvents(container);

    const saveEnfDraft = () => {
      if (!editingEnfermagemId && currentUser) {
        window.SamuStorage.saveDraft(currentUser.username, 'checklist_enfermagem', enfermagemState);
      }
    };

    document.getElementById('enf-data').addEventListener('input', e => { d.data = e.target.value; saveEnfDraft(); });
    document.getElementById('enf-turno').addEventListener('change', e => { d.turno = e.target.value; saveEnfDraft(); renderEnfermagemView(); });
    document.getElementById('enf-nome').addEventListener('input', e => { d.responsavelNome = e.target.value; saveEnfDraft(); });
    document.getElementById('enf-coren').addEventListener('input', e => { d.responsavelCoren = e.target.value; saveEnfDraft(); });
    document.getElementById('enf-obs-1').addEventListener('input', e => { d.obsPagina1 = e.target.value; saveEnfDraft(); });
    document.getElementById('enf-obs-2').addEventListener('input', e => { d.obsPagina2 = e.target.value; saveEnfDraft(); });

    container.querySelectorAll('[data-enf-sec]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeEnfSectionIdx = Number(btn.dataset.enfSec);
        renderEnfermagemView();
      });
    });

    const prevSec = document.getElementById('btn-enf-prev');
    const nextSec = document.getElementById('btn-enf-next');
    if (prevSec) prevSec.addEventListener('click', () => { if (activeEnfSectionIdx > 0) { activeEnfSectionIdx--; renderEnfermagemView(); } });
    if (nextSec) nextSec.addEventListener('click', () => { if (activeEnfSectionIdx < sections.length - 1) { activeEnfSectionIdx++; renderEnfermagemView(); } });

    document.getElementById('btn-sec-ok').addEventListener('click', () => {
      activeSec.items.forEach(it => { if (!targetMap[it.id]) targetMap[it.id] = 'OK'; });
      saveEnfDraft();
      renderEnfermagemView();
      showToast(`${activeSec.title}: todos os itens marcados OK!`);
    });

    document.getElementById('btn-enf-all-ok').addEventListener('click', () => {
      sections.forEach(sec => sec.items.forEach(it => { if (!targetMap[it.id]) targetMap[it.id] = 'OK'; }));
      saveEnfDraft();
      renderEnfermagemView();
      showToast('Todas as 10 mochilas/compartimentos marcados como OK!');
    });

    document.getElementById('btn-reset-enf').addEventListener('click', async () => {
      if (!(await samuConfirm('Limpar os dados deste Check List de Enfermagem?'))) return;
      editingEnfermagemId = null;
      enfermagemState = createEmptyEnfermagem();
      await window.SamuStorage.clearDraft(currentUser.username, 'checklist_enfermagem');
      renderEnfermagemView();
    });

    container.querySelectorAll('[data-enf-item]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.enfItem;
        const v = btn.dataset.val;
        targetMap[id] = (targetMap[id] === v) ? '' : v;
        saveEnfDraft();
        renderEnfermagemView();
      });
    });

    container.querySelectorAll('[data-enf-custom]').forEach(inp => {
      inp.addEventListener('input', () => {
        targetMap[inp.dataset.enfCustom] = inp.value;
        saveEnfDraft();
      });
    });

    document.getElementById('enf-sig-box').addEventListener('click', () => {
      window.SamuSignature.open({
        title: 'Assinatura – Enfermagem (Checagem Diária USB)',
        initialValue: d.sigEnfermagem,
        allowPersonalSave: true,
        username: currentUser ? currentUser.username : ''
      }, (dataUrl) => {
        d.sigEnfermagem = dataUrl;
        saveEnfDraft();
        renderEnfermagemView();
      });
    });

    const buildEnfRecord = (id, existing) => ({
      id,
      type: 'checklist_enfermagem',
      date: d.data || todayISO(),
      createdAt: (existing && existing.createdAt) || new Date().toISOString(),
      createdBy: (existing && existing.createdBy) || currentUser.username,
      createdByName: (existing && existing.createdByName) || d.responsavelNome || currentUser.name,
      createdByRole: (existing && existing.createdByRole) || currentUser.role,
      patientName: '',
      patientCpf: '',
      risk: '',
      incidentType: '',
      vehicle: 'USB',
      shift: d.turno,
      summary: `Checagem Diária USB (${d.turno}) • ${d.responsavelNome || ''}`,
      driveFileId: (existing && existing.driveFileId) || '',
      driveUrl: (existing && existing.driveUrl) || '',
      syncStatus: 'pending',
      data: JSON.parse(JSON.stringify(d))
    });

    document.getElementById('btn-preview-enf').addEventListener('click', async () => {
      await openPdfPreviewModal(buildEnfRecord(editingEnfermagemId || uid('ckenf')));
    });

    document.getElementById('btn-save-send-enf').addEventListener('click', async () => {
      const btn = document.getElementById('btn-save-send-enf');
      btn.disabled = true;
      btn.textContent = 'Gerando PDF e Salvando...';
      try {
        const recId = editingEnfermagemId || uid('ckenf');
        const existing = editingEnfermagemId ? await window.SamuStorage.getRecordById(editingEnfermagemId) : null;
        const record = buildEnfRecord(recId, existing);
        const generated = await window.SamuPDF.generatePdfForRecord(record);
        await window.SamuStorage.saveRecordLocal(record);
        const upRes = await window.SamuStorage.uploadRecordToDrive(record, generated.base64);
        await window.SamuStorage.clearDraft(currentUser.username, 'checklist_enfermagem');

        editingEnfermagemId = null;
        enfermagemState = createEmptyEnfermagem();
        await refreshDraftCount();
        await refreshSyncBadge();
        await openPdfPreviewModal(record, generated, upRes);
        renderEnfermagemView();
      } catch (err) {
        alert('Erro ao salvar Check List de Enfermagem: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 Salvar e Enviar PDF ao Google Drive';
      }
    });
  }

  /* ==========================================================================
   * ABA 4: HISTÓRICO COM BUSCA DE PACIENTES & CONTROLE POR PERFIL
   * ========================================================================== */
  async function renderHistoricoView() {
    const container = document.getElementById('main-view');
    const isAdmin = currentUser.role === 'admin';
    const visibleRecords = await window.SamuStorage.getVisibleRecords(currentUser);

    // Lista de profissionais únicos (para filtro do Admin)
    const uniqueUsers = [];
    const seenU = new Set();
    visibleRecords.forEach(r => {
      const u = String(r.createdBy || '').toLowerCase();
      if (u && !seenU.has(u)) {
        seenU.add(u);
        uniqueUsers.push({ username: u, name: r.createdByName || r.createdBy });
      }
    });

    const draftsTotal = visibleRecords.filter(r => r.syncStatus === 'draft').length;
    const q = normStr(historySearch.trim());
    const filtered = visibleRecords.filter(rec => {
      if (historyTypeFilter === 'drafts') {
        if (rec.syncStatus !== 'draft') return false;
      } else if (historyTypeFilter !== 'all' && rec.type !== historyTypeFilter) {
        return false;
      }
      if (isAdmin && historyUserFilter !== 'all' && String(rec.createdBy || '').toLowerCase() !== historyUserFilter) return false;
      if (!q) return true;
      const hay = normStr([
        rec.patientName,
        rec.patientCpf,
        rec.date,
        rec.incidentType,
        rec.risk,
        rec.vehicle,
        rec.summary,
        rec.createdByName,
        rec.createdBy
      ].join(' '));
      return hay.includes(q);
    });

    const typeFilterOptions = [
      { id: 'all', label: `Todos (${visibleRecords.length})` },
      { id: 'drafts', label: `📌 Rascunhos (${draftsTotal})` },
      { id: 'ficha', label: 'Fichas de Atendimento' }
    ];
    if (isAdmin || currentUser.role === 'condutor') {
      typeFilterOptions.push({ id: 'checklist_condutor', label: 'Check List Condutor' });
    }
    if (isAdmin || currentUser.role === 'enfermagem') {
      typeFilterOptions.push({ id: 'checklist_enfermagem', label: 'Check List Enfermagem' });
    }

    container.innerHTML = `
      <div class="card" style="padding:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
          <div>
            <strong style="font-size:1.05rem;">${isAdmin ? '🔎 Histórico Geral da Central (Adm)' : '🔎 Meu Histórico de Registros'}</strong>
            <div style="font-size:0.79rem; color:var(--muted);">
              ${isAdmin
                ? 'Acesso total: pesquisando em todas as fichas e checklists de condutores e técnicos.'
                : 'Privacidade ativa: exibindo apenas as fichas e checklists feitos no seu login.'}
            </div>
          </div>
          <button type="button" class="btn btn-outline btn-sm" id="btn-hist-sync">🔄 Atualizar Drive</button>
        </div>

        <div class="search-bar-box">
          <span class="search-bar-icon">🔍</span>
          <input type="search" id="inp-history-search" placeholder="Procurar nome do paciente, CPF, data (AAAA-MM-DD), endereço ou viatura..." value="${escapeHtml(historySearch)}" />
        </div>

        <div class="chips-wrap" style="margin-bottom:${isAdmin && uniqueUsers.length > 0 ? '10px' : '0'};">
          ${typeFilterOptions.map(opt => `
            <button type="button" class="chip-btn ${historyTypeFilter === opt.id ? 'selected' : ''}" data-htype="${opt.id}">${opt.label}</button>
          `).join('')}
        </div>

        ${isAdmin && uniqueUsers.length > 0 ? `
          <div class="field" style="margin-bottom:0; margin-top:8px;">
            <label>Filtrar por Profissional (Visão Adm)</label>
            <select id="sel-history-user">
              <option value="all">Todos os profissionais (${uniqueUsers.length})</option>
              ${uniqueUsers.map(u => `<option value="${escapeHtml(u.username)}" ${historyUserFilter === u.username ? 'selected' : ''}>${escapeHtml(u.name)} (${escapeHtml(u.username)})</option>`).join('')}
            </select>
          </div>
        ` : ''}
      </div>

      <div id="history-results-list">
        ${filtered.length === 0 ? `
          <div class="card" style="text-align:center; padding:32px 16px; color:var(--muted);">
            <div style="font-size:2rem; margin-bottom:8px;">📂</div>
            <strong>Nenhum registro encontrado</strong>
            <p style="margin:6px 0 0; font-size:0.88rem;">
              ${historySearch ? 'Tente buscar por parte do nome do paciente ou limpe o filtro.' : 'As fichas e checklists salvos aparecerão aqui para busca rápida e acesso ao PDF.'}
            </p>
          </div>
        ` : filtered.map(rec => renderHistoryCardHtml(rec, isAdmin)).join('')}
      </div>
    `;

    const searchInp = document.getElementById('inp-history-search');
    searchInp.addEventListener('input', e => {
      historySearch = e.target.value;
      const pos = searchInp.selectionStart;
      renderHistoricoView().then(() => {
        const el = document.getElementById('inp-history-search');
        if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (err) {} }
      });
    });

    container.querySelectorAll('[data-htype]').forEach(btn => {
      btn.addEventListener('click', () => {
        historyTypeFilter = btn.dataset.htype;
        renderHistoricoView();
      });
    });

    const userSel = document.getElementById('sel-history-user');
    if (userSel) {
      userSel.addEventListener('change', e => {
        historyUserFilter = e.target.value;
        renderHistoricoView();
      });
    }

    document.getElementById('btn-hist-sync').addEventListener('click', () => triggerBackgroundSync(true));

    // Ações dos cards do histórico
    container.querySelectorAll('[data-h-pdf]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const rec = await window.SamuStorage.getRecordById(btn.dataset.hPdf);
        if (rec) await openPdfPreviewModal(rec);
      });
    });

    container.querySelectorAll('[data-h-reg]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const rec = await window.SamuStorage.getRecordById(btn.dataset.hReg);
        if (rec && rec.type === 'ficha') await openRegulacaoHeaderModal(rec);
      });
    });

    container.querySelectorAll('[data-h-edit]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const rec = await window.SamuStorage.getRecordById(btn.dataset.hEdit);
        if (!rec) return;
        if (rec.type === 'ficha') {
          fichaState = normalizeFichaData(rec.data);
          editingFichaId = rec.id;
          fichaStep = 1;
          persistFichaDraft();
          activeTab = 'ficha';
        } else if (rec.type === 'checklist_condutor') {
          condutorState = Object.assign(createEmptyCondutor(), rec.data || {});
          editingCondutorId = rec.id;
          activeTab = 'condutor';
        } else if (rec.type === 'checklist_enfermagem') {
          enfermagemState = Object.assign(createEmptyEnfermagem(), rec.data || {});
          editingEnfermagemId = rec.id;
          activeTab = 'enfermagem';
        }
        renderBottomNav();
        renderActiveView();
        window.scrollTo(0, 0);
      });
    });

    container.querySelectorAll('[data-h-del-draft]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.hDelDraft;
        if (!(await samuConfirm('Excluir este rascunho permanentemente?'))) return;
        await window.SamuStorage.deleteRecordLocal(id);
        if (editingFichaId === id) {
          editingFichaId = null;
          fichaState = createEmptyFicha();
          await window.SamuStorage.clearDraft(currentUser.username, 'ficha');
        }
        await refreshDraftCount();
        renderHistoricoView();
      });
    });
  }

  function renderHistoryCardHtml(rec, isAdmin) {
    let badgeClass = 'type-ficha';
    let badgeText = 'Ficha de Atendimento';
    let title = rec.patientName || 'Paciente não identificado';

    if (rec.type === 'checklist_condutor') {
      badgeClass = 'type-condutor';
      badgeText = 'Check List Condutor';
      title = rec.vehicle || 'Viatura USB';
    } else if (rec.type === 'checklist_enfermagem') {
      badgeClass = 'type-enfermagem';
      badgeText = 'Check List Enfermagem';
      title = `Checagem Diária USB (${rec.shift || 'Plantão'})`;
    }

    const riskColors = { VERMELHA: '#dc2626', AMARELA: '#d97706', VERDE: '#16a34a', AZUL: '#2563eb' };
    const riskBadge = (rec.type === 'ficha' && rec.risk)
      ? `<span class="type-badge" style="background:${riskColors[rec.risk] || '#475569'}; color:#fff;">RISCO ${escapeHtml(rec.risk)}</span>`
      : '';

    const isDraft = rec.syncStatus === 'draft';
    const synced = rec.syncStatus === 'synced';
    const statusCls = isDraft ? 'status-draft' : (synced ? 'status-synced' : 'status-pending');
    const statusLabel = isDraft ? '📌 Rascunho (Em aberto)' : (synced ? '☁️ No Google Drive' : '⏳ Aguardando Drive');
    const dateParts = String(rec.date || '').split('-');
    const dateBR = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : rec.date;

    return `
      <div class="history-card">
        <div class="history-top">
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <span class="type-badge ${badgeClass}">${badgeText}</span>
            ${riskBadge}
          </div>
          <span class="status-tag ${statusCls}">
            ${statusLabel}
          </span>
        </div>
        <div class="history-title">${escapeHtml(title)}</div>
        <div class="history-meta">
          📅 <strong>${escapeHtml(dateBR)}</strong>
          ${rec.shift ? ` • ⏱ ${escapeHtml(rec.shift)}` : ''}
          ${rec.patientCpf ? ` • CPF: ${escapeHtml(rec.patientCpf)}` : ''}
          ${rec.incidentType ? `<br>🚨 ${escapeHtml(rec.incidentType)}` : ''}
          ${rec.summary ? `<br>📍 ${escapeHtml(rec.summary)}` : ''}
          ${isAdmin ? `<br>👤 Enviado por: <strong>${escapeHtml(rec.createdByName || rec.createdBy)}</strong> (${escapeHtml(rec.createdBy)})` : ''}
        </div>
        <div class="history-actions">
          <button type="button" class="btn btn-outline btn-sm" data-h-edit="${escapeHtml(rec.id)}">${isDraft ? '✏️ Continuar Preenchimento' : '✏️ Abrir / Editar'}</button>
          <button type="button" class="btn btn-primary btn-sm" data-h-pdf="${escapeHtml(rec.id)}">📄 Gerar / Imprimir PDF</button>
          ${rec.type === 'ficha' ? `<button type="button" class="btn btn-whatsapp btn-sm" data-h-reg="${escapeHtml(rec.id)}">📲 Cabeçalho Regulação</button>` : ''}
          ${rec.driveUrl ? `<a href="${escapeHtml(rec.driveUrl)}" target="_blank" rel="noopener" class="btn btn-success btn-sm" style="text-decoration:none;">☁️ Ver no Google Drive</a>` : ''}
          ${isDraft ? `<button type="button" class="btn btn-secondary btn-sm" data-h-del-draft="${escapeHtml(rec.id)}">🗑️ Excluir</button>` : ''}
        </div>
      </div>
    `;
  }

  /* ==========================================================================
   * ABA EXCLUSIVA ADM: APROVAÇÃO DE NOVOS CADASTROS (OFFLINE + GITHUB)
   * ========================================================================== */
  async function renderAprovacoesView(skipAutoPull) {
    if (!currentUser || currentUser.role !== 'admin') return;
    const container = document.getElementById('main-view');
    const hasGh = window.SamuStorage.hasGitHubConfigured();
    const ghMeta = window.SamuStorage.getGitHubMeta();

    // Consulta automaticamente a base do GitHub quando tiver internet
    if (!skipAutoPull && navigator.onLine && hasGh) {
      window.SamuStorage.syncInternalDbWithGitHub().then(async () => {
        if (currentUser && currentUser.role === 'admin' && activeTab === 'aprovacoes') {
          renderBottomNav();
          await refreshSyncBadge();
          renderAprovacoesView(true);
        }
      }).catch(() => {});
    }

    const pendingUsers = window.SamuStorage.getPendingUsers();
    const approvedUsers = window.SamuStorage.getLocalUsers().filter(u => u.status !== 'pending' && u.active !== false);
    const lastSyncText = ghMeta && ghMeta.lastSyncAt
      ? new Date(ghMeta.lastSyncAt).toLocaleString('pt-BR')
      : 'Ainda não sincronizado';

    container.innerHTML = `
      <div class="card">
        <div class="card-title"><span>✅ Aprovação de Novos Cadastros da Equipe</span></div>
        <p style="margin:0 0 10px; font-size:0.84rem; color:var(--muted);">
          Quando um Técnico de Enfermagem (Login, Senha, COREN e CPF) ou Condutor (Login, Senha e CPF) cria cadastro na tela inicial, a solicitação aparece aqui para você aprovar. Funciona <strong>100% offline pela Base Interna</strong> e sincroniza com o <strong>GitHub</strong> sempre que houver internet.
        </p>
        <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px;">
          <div style="font-size:0.8rem;">
            ${hasGh
              ? `🐙 <strong>GitHub configurado</strong> • Última consulta: <span>${escapeHtml(lastSyncText)}</span>`
              : `🗄️ <strong>Base Interna Offline ativa</strong> • <span style="color:var(--muted);">Configure o repositório na aba ⚙️ Base/GitHub p/ sincronizar entre aparelhos</span>`}
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="btn btn-primary btn-sm" id="btn-aprov-pull-gh">🔄 Consultar GitHub Agora</button>
            <button type="button" class="btn btn-outline btn-sm" id="btn-aprov-open-gh-cfg">⚙️ Configurar GitHub</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span>⏳ Solicitações Pendentes (${pendingUsers.length})</span></div>
        ${pendingUsers.length === 0 ? `
          <div style="padding:18px; text-align:center; background:#f0fdf4; border:1.5px dashed #86efac; border-radius:12px; color:#166534; font-weight:700; font-size:0.9rem;">
            🎉 Nenhum cadastro aguardando aprovação no momento.
          </div>
        ` : pendingUsers.map(u => {
          const isEnf = u.role === 'enfermagem';
          const reqDate = u.requestedAt ? new Date(u.requestedAt).toLocaleString('pt-BR') : 'Agora';
          return `
            <div class="approval-card">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
                <div>
                  <span class="type-badge ${isEnf ? 'type-enfermagem' : 'type-condutor'}">
                    ${isEnf ? '🩺 Téc. Enfermagem / Enfermeiro' : '🚑 Condutor Socorrista'}
                  </span>
                  <div style="font-size:1.02rem; font-weight:800; margin-top:4px; color:#0f172a;">${escapeHtml(u.name)}</div>
                </div>
                <small style="color:#92400e; font-weight:700;">📅 ${escapeHtml(reqDate)}</small>
              </div>

              <div style="font-size:0.84rem; color:#334155; margin-bottom:8px; line-height:1.5;">
                👤 Login solicitado: <strong><code>${escapeHtml(u.username)}</code></strong>
                • 🪪 CPF: <strong>${escapeHtml(u.cpf || 'Não informado')}</strong>
                ${isEnf ? `<br>🩺 COREN informado: <strong>${escapeHtml(u.coren || u.councilId || 'Não informado')}</strong>` : ''}
              </div>

              ${isEnf ? `
                <div class="field" style="margin-bottom:10px;">
                  <label>Confirmar / Ajustar COREN (já preencherá automático na ficha quando ele logar)</label>
                  <input type="text" data-aprov-coren="${escapeHtml(u.username)}" value="${escapeHtml(u.coren || u.councilId || '')}" placeholder="Ex: COREN-SP 542.810-TE" />
                </div>
              ` : ''}

              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button type="button" class="btn btn-success btn-sm" data-approve-user="${escapeHtml(u.username)}">✅ Aprovar Cadastro</button>
                <button type="button" class="btn btn-secondary btn-sm" data-reject-user="${escapeHtml(u.username)}">❌ Recusar / Excluir</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="card">
        <div class="card-title"><span>👥 Equipe Já Aprovada na Base Interna (${approvedUsers.length})</span></div>
        <div>
          ${approvedUsers.map(u => {
            const roleBadge = u.role === 'admin' ? '🔑 ADM' : (u.role === 'condutor' ? '🚑 Condutor' : '🩺 Enfermagem');
            const corenTxt = u.coren || u.councilId || '';
            return `
              <div class="check-item-row" style="flex-wrap:wrap;">
                <div class="check-item-info">
                  <strong>${escapeHtml(u.name)}</strong> <small style="color:var(--muted);">(${roleBadge})</small><br>
                  <small style="color:var(--muted);">
                    Login: <code>${escapeHtml(u.username)}</code>
                    ${u.cpf ? ` • CPF: ${escapeHtml(u.cpf)}` : ''}
                    ${corenTxt ? ` • <strong>${escapeHtml(corenTxt)}</strong>` : ''}
                  </small>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    const btnPullGh = document.getElementById('btn-aprov-pull-gh');
    if (btnPullGh) {
      btnPullGh.addEventListener('click', async () => {
        if (!window.SamuStorage.hasGitHubConfigured()) {
          activeTab = 'admin';
          renderBottomNav();
          renderActiveView();
          showToast('Informe o repositório GitHub abaixo para ativar a sincronização online.');
          return;
        }
        if (!navigator.onLine) {
          showToast('📴 Sem internet agora — exibindo cadastros da Base Interna Offline.');
          return;
        }
        btnPullGh.disabled = true;
        btnPullGh.textContent = 'Consultando GitHub...';
        try {
          await window.SamuStorage.syncInternalDbWithGitHub();
          renderBottomNav();
          await refreshSyncBadge();
          renderAprovacoesView(true);
          showToast('✅ Base de dados do GitHub consultada e atualizada!');
        } catch (err) {
          samuAlert('Erro ao consultar o GitHub: ' + err.message);
        } finally {
          btnPullGh.disabled = false;
          btnPullGh.textContent = '🔄 Consultar GitHub Agora';
        }
      });
    }

    const btnOpenCfg = document.getElementById('btn-aprov-open-gh-cfg');
    if (btnOpenCfg) {
      btnOpenCfg.addEventListener('click', () => {
        activeTab = 'admin';
        renderBottomNav();
        renderActiveView();
      });
    }

    container.querySelectorAll('[data-approve-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uname = btn.dataset.approveUser;
        const corenInput = container.querySelector(`[data-aprov-coren="${CSS.escape ? CSS.escape(uname) : uname}"]`);
        const overrides = {};
        if (corenInput) {
          overrides.coren = corenInput.value.trim();
          overrides.councilId = overrides.coren;
        }
        btn.disabled = true;
        btn.textContent = 'Aprovando...';
        try {
          const res = await window.SamuStorage.approveUser(uname, overrides, currentUser.username);
          renderBottomNav();
          await refreshSyncBadge();
          renderAprovacoesView(true);
          showToast(res.githubSynced
            ? `✅ "${uname}" aprovado na Base Interna e atualizado no GitHub!`
            : `✅ "${uname}" aprovado na Base Interna! (Sincronizará c/ GitHub ao conectar)`);
        } catch (err) {
          samuAlert('Erro ao aprovar cadastro: ' + err.message);
          btn.disabled = false;
          btn.textContent = '✅ Aprovar Cadastro';
        }
      });
    });

    container.querySelectorAll('[data-reject-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uname = btn.dataset.rejectUser;
        if (!(await samuConfirm(`Recusar e excluir a solicitação de cadastro "${uname}"?`))) return;
        await window.SamuStorage.rejectUser(uname);
        renderBottomNav();
        await refreshSyncBadge();
        renderAprovacoesView(true);
        showToast(`Solicitação de "${uname}" recusada.`);
      });
    });
  }

  /* ==========================================================================
   * ABA 6 (EXCLUSIVA ADM): BASE INTERNA + GITHUB, EQUIPE & GOOGLE DRIVE
   * ========================================================================== */
  async function renderAdminView() {
    if (!currentUser || currentUser.role !== 'admin') return;
    const container = document.getElementById('main-view');
    const settings = window.SamuStorage.getSettings();

    // Tenta buscar usuários atualizados do GitHub / Google Apps Script se conectado
    if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
      try {
        await window.SamuStorage.syncInternalDbWithGitHub();
      } catch (e) {}
    } else if (settings.scriptUrl && navigator.onLine) {
      try {
        const res = await window.SamuStorage.apiPost({
          action: 'listUsers',
          authUser: currentUser.username,
          authPass: currentUser.password
        });
        if (res && res.ok && Array.isArray(res.users)) {
          window.SamuStorage.setLocalUsers(res.users);
        }
      } catch (e) {}
    }

    const allUsers = window.SamuStorage.getLocalUsers();
    const pendingUsers = window.SamuStorage.getPendingUsers();
    const users = allUsers.filter(u => u.status !== 'pending');
    const receiversCount = window.SamuStorage.getHospitalReceivers().length;
    const patientsCount = Object.keys(window.SamuStorage.getInternalPatientsMap() || {}).length;
    const ghMeta = window.SamuStorage.getGitHubMeta();

    container.innerHTML = `
      <div class="card">
        <div class="card-title"><span>🗄️ Base de Dados Interna (Offline) + GitHub</span></div>
        <p style="margin:0 0 10px; font-size:0.84rem; color:var(--muted);">
          O APK mantém uma <strong>Base Interna Offline</strong> no aparelho (funciona 100% sem sinal) e consulta/atualiza automaticamente o arquivo JSON no <strong>GitHub</strong> sempre que houver internet (logins, aprovações, COREN, recebedores do hospital e pacientes por CPF).
        </p>

        <div class="chips-wrap" style="margin-bottom:12px;">
          <span class="type-badge" style="background:#0f172a; color:#fff;">
            ${(window.SamuStorage.isNativeSqliteActive && window.SamuStorage.isNativeSqliteActive())
              ? '🗄️ Motor: SQLite Nativo Android (samu_orlandia_192.db)'
              : '💻 Simulador PC (No APK usa SQLite Nativo Android)'}
          </span>
          ${(() => {
            const iv = window.SamuStorage.getInstalledAppVersion ? window.SamuStorage.getInstalledAppVersion() : { apkVersionName: '1.0.0', otaRevision: 1 };
            return `<span class="type-badge" style="background:#dcfce7; color:#14532d;">🚀 Versão v${escapeHtml(iv.apkVersionName)} • Rev #${escapeHtml(String(iv.otaRevision))}</span>`;
          })()}
          <span class="type-badge type-enfermagem">👥 Aprovados: ${users.length}</span>
          <span class="type-badge" style="background:#fef3c7; color:#92400e;">⏳ Pendentes: ${pendingUsers.length}</span>
          <span class="type-badge type-condutor">🏥 Recebedores Salvos: ${receiversCount}</span>
          <span class="type-badge type-ficha">🪪 CPFs na Base: ${patientsCount}</span>
        </div>

        <div class="field">
          <label>Repositório GitHub (Base de Dados + Compilação &amp; Auto-Update do APK)</label>
          <input type="text" id="adm-gh-repo" placeholder="guileao97/samu-fichas-e-checklist" value="${escapeHtml(settings.githubRepo || 'guileao97/samu-fichas-e-checklist')}" />
        </div>
        <div class="grid-3">
          <div class="field">
            <label>Branch</label>
            <input type="text" id="adm-gh-branch" placeholder="main" value="${escapeHtml(settings.githubBranch || 'main')}" />
          </div>
          <div class="field">
            <label>Arquivo JSON no Repositório</label>
            <input type="text" id="adm-gh-path" placeholder="base_dados_samu.json" value="${escapeHtml(settings.githubFilePath || 'base_dados_samu.json')}" />
          </div>
          <div class="field">
            <label>Hospital Padrão nas Fichas</label>
            <input type="text" id="adm-default-hospital" placeholder="HBSA" value="${escapeHtml(settings.defaultHospital || 'HBSA')}" />
          </div>
        </div>
        <div class="field">
          <label>Token do GitHub (Personal Access Token c/ permissão <em>Contents: Read &amp; Write</em> p/ gravar cadastros e aprovações)</label>
          <input type="password" id="adm-gh-token" placeholder="ghp_... ou github_pat_..." value="${escapeHtml(settings.githubToken || '')}" />
        </div>
        ${ghMeta && ghMeta.lastSyncAt ? `
          <div style="font-size:0.78rem; color:#15803d; font-weight:700; margin-bottom:8px;">
            ✅ Última sincronização com GitHub: ${escapeHtml(new Date(ghMeta.lastSyncAt).toLocaleString('pt-BR'))}
          </div>
        ` : ''}
        <div style="display:flex; flex-wrap:wrap; gap:8px;">
          <button type="button" class="btn btn-primary btn-sm" id="btn-adm-sync-gh">🐙 Salvar e Sincronizar com GitHub</button>
          <button type="button" class="btn btn-whatsapp btn-sm" id="btn-adm-check-update">🚀 Buscar Atualização do APK</button>
          <button type="button" class="btn btn-outline btn-sm" id="btn-adm-export-db">📥 Baixar base_dados_samu.json</button>
          <button type="button" class="btn btn-outline btn-sm" id="btn-adm-import-db">📂 Importar JSON na Base Interna</button>
          <input type="file" id="inp-adm-import-file" accept=".json,application/json" class="hidden" />
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span>☁️ Conexão com Google Drive da Central SAMU (PDFs)</span></div>
        <p style="margin:0 0 10px; font-size:0.84rem; color:var(--muted);">
          Todos os PDFs das Fichas e Check Lists enviados pelos celulares caem automaticamente organizados em pastas no Google Drive conectado abaixo.
        </p>
        <div class="field">
          <label>URL do App da Web (Google Apps Script – termina em /exec)</label>
          <input type="url" id="adm-script-url" placeholder="https://script.google.com/macros/s/.../exec" value="${escapeHtml(settings.scriptUrl || '')}" />
        </div>
        <div class="field">
          <label>API Externa de Consulta CPF (opcional – use {cpf} na URL se a Prefeitura tiver token Serpro/CPFHub)</label>
          <input type="url" id="adm-cpf-api-url" placeholder="Opcional (pacientes já atendidos pelo SAMU já puxam pelo CPF sem API externa)" value="${escapeHtml(settings.cpfApiUrl || '')}" />
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:8px;">
          <button type="button" class="btn btn-primary btn-sm" id="btn-adm-test-drive">🔌 Testar e Salvar Conexão Drive</button>
          ${settings.scriptUrl ? `<button type="button" class="btn btn-outline btn-sm" id="btn-adm-copy-url">📋 Copiar Link p/ Celulares da Equipe</button>` : ''}
          ${settings.rootFolderUrl ? `<a href="${escapeHtml(settings.rootFolderUrl)}" target="_blank" class="btn btn-success btn-sm" style="text-decoration:none;">📁 Abrir Pasta Google Drive</a>` : ''}
          ${settings.spreadsheetUrl ? `<a href="${escapeHtml(settings.spreadsheetUrl)}" target="_blank" class="btn btn-orange btn-sm" style="text-decoration:none;">📊 Abrir Planilha de Controle</a>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span>👥 Cadastrar / Editar Login de Profissional (Já Aprovado)</span></div>
        <form id="adm-user-form" autocomplete="off">
          <div class="grid-2">
            <div class="field">
              <label>Nome Completo do Funcionário</label>
              <input type="text" id="u-name" placeholder="Ex: Marcos Oliveira" required />
            </div>
            <div class="field">
              <label>Função / Perfil de Acesso</label>
              <select id="u-role">
                <option value="enfermagem">🩺 Técnico de Enfermagem / Enfermeiro (COREN pré-preenche na ficha)</option>
                <option value="condutor">🚑 Condutor Socorrista (Login, Senha e CPF)</option>
                <option value="admin">🔑 Administrador / Coordenação (vê tudo e aprova cadastros)</option>
              </select>
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label>Login (Usuário para entrar no APK)</label>
              <input type="text" id="u-username" placeholder="Ex: marcos" autocapitalize="none" required />
            </div>
            <div class="field">
              <label>Senha</label>
              <input type="text" id="u-password" placeholder="Ex: 1920" required />
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label>CPF do Profissional</label>
              <input type="text" id="u-cpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" />
            </div>
            <div class="field" id="u-coren-wrap">
              <label>COREN (pré-preenche automático na ficha ao logar)</label>
              <input type="text" id="u-council" placeholder="Ex: COREN-SP 542.810-TE" />
            </div>
          </div>
          <button type="submit" class="btn btn-success" id="btn-save-user">➕ Salvar Profissional na Base</button>
        </form>
      </div>

      <div class="card">
        <div class="card-title"><span>📋 Equipe Aprovada (${users.length})</span></div>
        <div>
          ${users.map(u => {
            const roleBadge = u.role === 'admin' ? '🔑 ADM (Vê Tudo)' : (u.role === 'condutor' ? '🚑 Condutor' : '🩺 Enfermagem');
            const corenVal = u.coren || u.councilId || '';
            return `
              <div class="check-item-row" style="flex-wrap:wrap;">
                <div class="check-item-info">
                  <strong>${escapeHtml(u.name)}</strong> <small style="color:var(--muted);">(${roleBadge})</small><br>
                  <small style="color:var(--muted);">
                    Login: <code>${escapeHtml(u.username)}</code> • Senha: <code>${escapeHtml(u.password || '****')}</code>
                    ${u.cpf ? ` • CPF: ${escapeHtml(u.cpf)}` : ''}
                    ${corenVal ? ` • <strong>${escapeHtml(corenVal)}</strong>` : ''}
                  </small>
                </div>
                <div style="display:flex; gap:6px;">
                  <button type="button" class="btn btn-outline btn-sm" data-edit-u="${escapeHtml(u.username)}">Editar</button>
                  ${u.username.toLowerCase() !== currentUser.username.toLowerCase()
                    ? `<button type="button" class="btn btn-secondary btn-sm" data-del-u="${escapeHtml(u.username)}">Excluir</button>`
                    : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Oculta campo COREN quando perfil selecionado for Condutor
    const uRoleSel = document.getElementById('u-role');
    const uCorenWrap = document.getElementById('u-coren-wrap');
    const syncRoleCorenVisibility = () => {
      if (!uRoleSel || !uCorenWrap) return;
      uCorenWrap.style.display = uRoleSel.value === 'condutor' ? 'none' : '';
    };
    if (uRoleSel) {
      uRoleSel.addEventListener('change', syncRoleCorenVisibility);
      syncRoleCorenVisibility();
    }

    const uCpfInp = document.getElementById('u-cpf');
    if (uCpfInp) {
      uCpfInp.addEventListener('input', () => {
        uCpfInp.value = window.SamuStorage.formatCpf(uCpfInp.value);
      });
    }

    // Buscar Atualização do APK / Live OTA no GitHub
    const btnCheckUpd = document.getElementById('btn-adm-check-update');
    if (btnCheckUpd) {
      btnCheckUpd.addEventListener('click', async () => {
        const githubRepo = document.getElementById('adm-gh-repo').value.trim() || 'guileao97/samu-fichas-e-checklist';
        const githubBranch = document.getElementById('adm-gh-branch').value.trim() || 'main';
        const githubToken = document.getElementById('adm-gh-token').value.trim();
        window.SamuStorage.saveSettings({ githubRepo, githubBranch, githubToken });
        if (window.__samuCheckAppUpdate) {
          await window.__samuCheckAppUpdate(true);
        }
      });
    }

    // Salvar e sincronizar Base Interna com GitHub
    const btnSyncGh = document.getElementById('btn-adm-sync-gh');
    if (btnSyncGh) {
      btnSyncGh.addEventListener('click', async () => {
        const githubRepo = document.getElementById('adm-gh-repo').value.trim();
        const githubBranch = document.getElementById('adm-gh-branch').value.trim() || 'main';
        const githubFilePath = document.getElementById('adm-gh-path').value.trim() || 'base_dados_samu.json';
        const githubToken = document.getElementById('adm-gh-token').value.trim();
        const defaultHospital = document.getElementById('adm-default-hospital').value.trim() || 'HBSA';

        window.SamuStorage.saveSettings({
          githubRepo,
          githubBranch,
          githubFilePath,
          githubToken,
          defaultHospital
        });

        if (!fichaState.destino || fichaState.destino === 'HBSA') {
          fichaState.destino = defaultHospital;
        }

        if (!githubRepo) {
          await refreshSyncBadge();
          renderAdminView();
          showToast(`🗄️ Configurações salvas na Base Interna Offline (Hospital padrão: ${defaultHospital}).`);
          return;
        }

        if (!navigator.onLine) {
          await refreshSyncBadge();
          showToast('📴 Configuração salva! Sem internet agora — sincronizará com o GitHub assim que conectar.');
          return;
        }

        btnSyncGh.disabled = true;
        btnSyncGh.textContent = 'Sincronizando com GitHub...';
        try {
          const res = await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: Boolean(githubToken) });
          renderBottomNav();
          await refreshSyncBadge();
          renderAdminView();
          showToast(res.pushed
            ? '🐙 Base Interna consultada e gravada no GitHub com sucesso!'
            : '🐙 Base de dados consultada do GitHub com sucesso!');
        } catch (err) {
          samuAlert('Erro ao sincronizar com GitHub: ' + err.message);
        } finally {
          btnSyncGh.disabled = false;
          btnSyncGh.textContent = '🐙 Salvar e Sincronizar com GitHub';
        }
      });
    }

    // Exportar JSON da Base Interna (pronto para subir no GitHub)
    const btnExportDb = document.getElementById('btn-adm-export-db');
    if (btnExportDb) {
      btnExportDb.addEventListener('click', () => {
        const payload = window.SamuStorage.buildInternalDbExportObject();
        const jsonStr = JSON.stringify(payload, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'base_dados_samu.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 400);
        showToast('📥 Arquivo base_dados_samu.json baixado!');
      });
    }

    // Importar JSON para a Base Interna
    const btnImportDb = document.getElementById('btn-adm-import-db');
    const inpImportFile = document.getElementById('inp-adm-import-file');
    if (btnImportDb && inpImportFile) {
      btnImportDb.addEventListener('click', () => inpImportFile.click());
      inpImportFile.addEventListener('change', (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            window.SamuStorage.importInternalDbJson(String(reader.result || ''));
            renderBottomNav();
            await refreshSyncBadge();
            renderAdminView();
            showToast('✅ Base de dados importada para a Base Interna com sucesso!');
          } catch (err) {
            samuAlert('Arquivo JSON inválido: ' + err.message);
          }
        };
        reader.readAsText(file, 'utf-8');
      });
    }

    document.getElementById('btn-adm-test-drive').addEventListener('click', async () => {
      const url = document.getElementById('adm-script-url').value.trim();
      const cpfApiUrl = (document.getElementById('adm-cpf-api-url') && document.getElementById('adm-cpf-api-url').value.trim()) || '';
      window.SamuStorage.saveSettings({ cpfApiUrl });
      if (!url) {
        window.SamuStorage.saveSettings({ scriptUrl: '', rootFolderUrl: '', spreadsheetUrl: '', cpfApiUrl });
        await refreshSyncBadge();
        renderAdminView();
        showToast(cpfApiUrl ? 'API de CPF salva (modo local).' : 'Modo local ativado.');
        return;
      }
      const btn = document.getElementById('btn-adm-test-drive');
      btn.disabled = true;
      btn.textContent = 'Testando Google Drive...';
      try {
        const res = await window.SamuStorage.apiPost({ action: 'ping' }, url);
        if (res && res.ok) {
          window.SamuStorage.saveSettings({
            scriptUrl: url,
            rootFolderUrl: res.rootFolderUrl || '',
            spreadsheetUrl: res.spreadsheetUrl || ''
          });
          await refreshSyncBadge();
          showToast('Conectado ao Google Drive com sucesso!');
          renderAdminView();
        } else {
          throw new Error((res && res.error) || 'Resposta inesperada.');
        }
      } catch (err) {
        samuAlert('Não foi possível conectar na URL informada: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '🔌 Testar e Salvar Conexão Drive';
      }
    });

    const copyBtn = document.getElementById('btn-adm-copy-url');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const url = window.SamuStorage.getSettings().scriptUrl;
        if (navigator.clipboard && url) {
          await navigator.clipboard.writeText(url);
          showToast('URL copiada! Envie no WhatsApp da equipe para colarem na tela inicial do APK.');
        }
      });
    }

    document.getElementById('adm-user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const roleVal = document.getElementById('u-role').value;
      const corenVal = roleVal === 'condutor' ? '' : document.getElementById('u-council').value.trim();
      const userData = {
        name: document.getElementById('u-name').value.trim(),
        role: roleVal,
        username: document.getElementById('u-username').value.trim().toLowerCase(),
        password: document.getElementById('u-password').value.trim(),
        cpf: window.SamuStorage.formatCpf(document.getElementById('u-cpf').value),
        coren: corenVal,
        councilId: corenVal,
        status: 'approved',
        active: true,
        updatedAt: new Date().toISOString()
      };
      const btn = document.getElementById('btn-save-user');
      btn.disabled = true;
      btn.textContent = 'Salvando...';
      try {
        window.SamuStorage.upsertLocalUser(userData);
        if (navigator.onLine && window.SamuStorage.hasGitHubConfigured() && window.SamuStorage.getSettings().githubToken) {
          try { await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: true }); } catch (eGh) {}
        }
        const curSettings = window.SamuStorage.getSettings();
        if (curSettings.scriptUrl && navigator.onLine) {
          const res = await window.SamuStorage.apiPost({
            action: 'saveUser',
            authUser: currentUser.username,
            authPass: currentUser.password,
            userData
          });
          if (res && !res.ok) throw new Error(res.error);
        }
        renderBottomNav();
        showToast(`✅ Profissional "${userData.username}" salvo na Base Interna${window.SamuStorage.hasGitHubConfigured() ? ' e GitHub' : ''}!`);
        renderAdminView();
      } catch (err) {
        samuAlert('Salvo na Base Interna, mas houve aviso na nuvem: ' + err.message);
        renderAdminView();
      } finally {
        btn.disabled = false;
        btn.textContent = '➕ Salvar Profissional na Base';
      }
    });

    container.querySelectorAll('[data-edit-u]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = users.find(u => u.username.toLowerCase() === btn.dataset.editU.toLowerCase());
        if (!target) return;
        document.getElementById('u-name').value = target.name || '';
        document.getElementById('u-role').value = target.role || 'condutor';
        document.getElementById('u-username').value = target.username || '';
        document.getElementById('u-password').value = target.password || '';
        document.getElementById('u-cpf').value = target.cpf || '';
        document.getElementById('u-council').value = target.coren || target.councilId || '';
        syncRoleCorenVisibility();
        document.getElementById('adm-user-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    container.querySelectorAll('[data-del-u]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uname = btn.dataset.delU;
        if (!(await samuConfirm(`Remover o login "${uname}" da Base Interna e GitHub?`))) return;
        window.SamuStorage.deleteLocalUser(uname);
        if (navigator.onLine && window.SamuStorage.hasGitHubConfigured() && window.SamuStorage.getSettings().githubToken) {
          try { await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: true }); } catch (eGh) {}
        }
        const curSettings = window.SamuStorage.getSettings();
        if (curSettings.scriptUrl && navigator.onLine) {
          try {
            await window.SamuStorage.apiPost({
              action: 'deleteUser',
              authUser: currentUser.username,
              authPass: currentUser.password,
              username: uname
            });
          } catch (e) {}
        }
        renderBottomNav();
        showToast(`Usuário "${uname}" removido.`);
        renderAdminView();
      });
    });
  }

  /* ==========================================================================
   * MODAL DE VISUALIZAÇÃO DAS PÁGINAS A4 OFICIAIS + FOTO DO CABEÇALHO REGULAÇÃO
   * ========================================================================== */
  async function openRegulacaoHeaderModal(record) {
    const modal = document.getElementById('regulacao-photo-modal');
    const box = document.getElementById('regulacao-photo-container');
    if (!modal || !box) return;

    modal.classList.remove('hidden');
    box.innerHTML = `<div style="padding:36px; color:#cbd5e1;">Gerando foto nítida do cabeçalho até os horários...</div>`;

    const imgObj = await window.SamuPDF.generateFichaRegulacaoHeaderImage(record);
    regPhotoCurrentRecord = record;
    regPhotoGenerated = imgObj;

    box.innerHTML = `
      <div style="width:100%; display:flex; flex-direction:column; align-items:center; gap:8px;">
        <small style="color:#86efac; font-weight:800;">FOTO PRONTA P/ WHATSAPP DA REGULAÇÃO MÉDICA (CABEÇALHO + VÍTIMA + HORÁRIOS)</small>
        <img src="${imgObj.dataUrl}" alt="Foto do Cabeçalho da Ficha p/ Regulação" style="width:100%; max-width:780px; background:#fff; border-radius:6px; box-shadow:0 8px 25px rgba(0,0,0,0.45);" />
      </div>
    `;
  }

  async function openPdfPreviewModal(record, preGenerated, uploadResult) {
    const modal = document.getElementById('pdf-preview-modal');
    const pagesBox = document.getElementById('preview-pages-container');
    const statusEl = document.getElementById('preview-drive-status');
    const btnPrevReg = document.getElementById('btn-preview-regulacao');
    if (btnPrevReg) {
      btnPrevReg.classList.toggle('hidden', !record || record.type !== 'ficha');
    }

    modal.classList.remove('hidden');
    pagesBox.innerHTML = `<div style="padding:40px; color:#cbd5e1;">Gerando páginas oficiais em alta resolução...</div>`;

    const generated = preGenerated || await window.SamuPDF.generatePdfForRecord(record);
    previewCurrentRecord = record;
    previewGeneratedPdf = generated;

    if (uploadResult) {
      if (uploadResult.synced) {
        statusEl.textContent = '✅ Salvo e enviado automaticamente para o Google Drive!';
      } else if (uploadResult.reason === 'no_url') {
        statusEl.textContent = '💾 Salvo no aparelho (conecte o Google Drive em Equipe/Drive para envio automático).';
      } else {
        statusEl.textContent = '⏳ Salvo no aparelho! Sem internet agora — enviará ao Google Drive automaticamente.';
      }
    } else if (record.driveUrl) {
      statusEl.textContent = '☁️ Este PDF já está arquivado no Google Drive.';
    } else {
      statusEl.textContent = 'Visualização fiel de impressão (2 páginas A4)';
    }

    pagesBox.innerHTML = generated.canvases.map((cv, i) => `
      <div style="width:100%; display:flex; flex-direction:column; align-items:center; gap:6px;">
        <small style="color:#94a3b8; font-weight:700;">PÁGINA ${i + 1} DE ${generated.canvases.length}</small>
        <img src="${cv.toDataURL('image/jpeg', 0.92)}" alt="Página ${i + 1}" />
      </div>
    `).join('');
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
