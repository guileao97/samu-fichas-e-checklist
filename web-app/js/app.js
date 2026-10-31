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

  // Estado da Equipe do Plantão (2 ou até 3 integrantes) e sincronização em tempo real da Ficha
  let activeCrew = null;
  let currentCrewSessionId = '';
  let currentCrewIsLoadedRecord = false;
  let currentFichaFieldTs = {};
  let lastSyncedFichaSnapshot = null;
  let crewPushTimer = null;
  let manualShowSecondEnf = false;
  let manualShowSecondCond = false;

  let condutorState = null;
  let editingCondutorId = null;
  let activeDamageCode = 'A';
  let condutorValidationActive = false;

  let enfermagemState = null;
  let editingEnfermagemId = null;
  let activeEnfSectionIdx = 0;
  let enfermagemValidationActive = false;

  // Estado do filtro de histórico e listas rápidas
  let historySearch = '';
  let historyTypeFilter = 'all';
  let historyUserFilter = 'all';
  let medFilterQuery = '';
  let alergiaFilterQuery = '';
  let openSelectBoxKey = '';
  let cachedDraftCount = 0;
  let adminCatalogTab = 'patients';
  let adminCatalogSearch = '';
  let pendingCpfSuggestion = null;
  let cpfAutoFilledFromSaved = '';
  let cpfSuggestionDismissedFor = '';

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
      const hasNewlines = String(message || '').includes('\n');
      dlg.innerHTML = `
        <div class="card" style="width:100%; max-width:400px; margin:0; padding:20px; text-align:center;">
          <div style="font-size:1.5rem; margin-bottom:6px;">${isAlertOnly ? 'ℹ️' : '⚠️'}</div>
          <p style="margin:0 0 16px; font-weight:700; font-size:0.93rem; color:var(--text); white-space:pre-line; text-align:${hasNewlines ? 'left' : 'center'}; line-height:1.45;">${escapeHtml(message)}</p>
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

  function extractPhoneDigitsBR(raw, autoDefaultDdd) {
    let d = String(raw || '').replace(/\D+/g, '');
    if (!d) return '';
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) {
      d = d.slice(2);
    } else if (d.length === 12 && d.startsWith('0')) {
      d = d.slice(1);
    }
    if (autoDefaultDdd && (d.length === 8 || d.length === 9)) {
      d = '16' + d;
    }
    return d.slice(0, 11);
  }

  function formatPhoneBR(raw, autoDefaultDdd) {
    const d = extractPhoneDigitsBR(raw, autoDefaultDdd);
    if (!d) return '';
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)} ${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 3)} ${d.slice(3, 7)} ${d.slice(7, 11)}`;
  }

  function getPhoneKindBR(raw) {
    const d = extractPhoneDigitsBR(raw, false);
    if (d.length === 11 || d.length === 9) return 'celular';
    if (d.length === 10 || d.length === 8) return 'telefone';
    return '';
  }

  function buildVictimPhoneKindBadgeHtml(raw) {
    const kind = getPhoneKindBR(raw);
    if (kind === 'celular') {
      return '<span style="background:#dbeafe; color:#1e40af; font-size:0.68rem; font-weight:800; padding:1px 7px; border-radius:999px; margin-left:4px; text-transform:none;">📱 Celu&#8204;lar (9 dígitos)</span>';
    }
    if (kind === 'telefone') {
      return '<span style="background:#fef3c7; color:#92400e; font-size:0.68rem; font-weight:800; padding:1px 7px; border-radius:999px; margin-left:4px; text-transform:none;">☎️ Tele&#8204;fone (8 dígitos)</span>';
    }
    return '<span style="font-size:0.68rem; color:var(--muted); font-weight:600; margin-left:4px; text-transform:none;">(auto 8 ou 9 dígitos)</span>';
  }

  function refreshVictimPhoneKindBadge(rawVal) {
    const el = document.getElementById('vit-cnt-kind-lbl');
    if (el) {
      el.innerHTML = buildVictimPhoneKindBadgeHtml(rawVal);
    }
  }

  function applyCrewToFichaState(targetFicha, crew, forceReplaceSlots) {
    if (!targetFicha || !crew) return targetFicha;

    const n1 = (crew.nursingSlots && crew.nursingSlots[0]) || null;
    const n2 = (crew.nursingSlots && crew.nursingSlots[1]) || null;
    const c1 = (crew.driverSlots && crew.driverSlots[0]) || null;
    const c2 = (crew.driverSlots && crew.driverSlots[1]) || null;

    const prevEnf1User = String(targetFicha.enfermagemSlot1User || '').toLowerCase();
    const prevEnf2User = String(targetFicha.enfermagemSlot2User || '').toLowerCase();
    const prevEnf1Sig = targetFicha.sigEnfermagem || '';
    const prevEnf2Sig = targetFicha.sigEnfermagem2 || '';

    if (n1) {
      if (forceReplaceSlots || !targetFicha.enfermagemNome) {
        targetFicha.enfermagemNome = n1.name;
      }
      if (forceReplaceSlots || !targetFicha.enfermagemCoren) {
        targetFicha.enfermagemCoren = n1.coren || '';
      }
      targetFicha.enfermagemSlot1User = n1.username;
      if (prevEnf1User === n1.username && prevEnf1Sig) {
        targetFicha.sigEnfermagem = prevEnf1Sig;
      } else if (prevEnf2User === n1.username && prevEnf2Sig) {
        targetFicha.sigEnfermagem = prevEnf2Sig;
      } else if (forceReplaceSlots || !targetFicha.sigEnfermagem) {
        targetFicha.sigEnfermagem = n1.savedSignature || '';
      }
    }

    if (n2) {
      if (forceReplaceSlots || !targetFicha.enfermagem2Nome) {
        targetFicha.enfermagem2Nome = n2.name;
      }
      if (forceReplaceSlots || !targetFicha.enfermagem2Coren) {
        targetFicha.enfermagem2Coren = n2.coren || '';
      }
      targetFicha.enfermagemSlot2User = n2.username;
      if (prevEnf2User === n2.username && prevEnf2Sig) {
        targetFicha.sigEnfermagem2 = prevEnf2Sig;
      } else if (prevEnf1User === n2.username && prevEnf1Sig) {
        targetFicha.sigEnfermagem2 = prevEnf1Sig;
      } else if (forceReplaceSlots || !targetFicha.sigEnfermagem2) {
        targetFicha.sigEnfermagem2 = n2.savedSignature || '';
      }
    } else if (forceReplaceSlots) {
      targetFicha.enfermagem2Nome = '';
      targetFicha.enfermagem2Coren = '';
      targetFicha.sigEnfermagem2 = '';
      targetFicha.enfermagemSlot2User = '';
    }

    const prevCond1User = String(targetFicha.condutorSlot1User || '').toLowerCase();
    const prevCond2User = String(targetFicha.condutorSlot2User || '').toLowerCase();
    const prevCond1Sig = targetFicha.sigCondutor || '';
    const prevCond2Sig = targetFicha.sigCondutor2 || '';

    if (c1) {
      if (forceReplaceSlots || !targetFicha.condutorNome) {
        targetFicha.condutorNome = c1.name;
      }
      targetFicha.condutorSlot1User = c1.username;
      if (prevCond1User === c1.username && prevCond1Sig) {
        targetFicha.sigCondutor = prevCond1Sig;
      } else if (prevCond2User === c1.username && prevCond2Sig) {
        targetFicha.sigCondutor = prevCond2Sig;
      } else if (forceReplaceSlots || !targetFicha.sigCondutor) {
        targetFicha.sigCondutor = c1.savedSignature || '';
      }
    }

    if (c2) {
      if (forceReplaceSlots || !targetFicha.condutor2Nome) {
        targetFicha.condutor2Nome = c2.name;
      }
      targetFicha.condutorSlot2User = c2.username;
      if (prevCond2User === c2.username && prevCond2Sig) {
        targetFicha.sigCondutor2 = prevCond2Sig;
      } else if (prevCond1User === c2.username && prevCond1Sig) {
        targetFicha.sigCondutor2 = prevCond1Sig;
      } else if (forceReplaceSlots || !targetFicha.sigCondutor2) {
        targetFicha.sigCondutor2 = c2.savedSignature || '';
      }
    } else if (forceReplaceSlots) {
      targetFicha.condutor2Nome = '';
      targetFicha.sigCondutor2 = '';
      targetFicha.condutorSlot2User = '';
    }

    return targetFicha;
  }

  function createEmptyFicha() {
    const isEnf = currentUser && currentUser.role === 'enfermagem';
    const isCond = currentUser && currentUser.role === 'condutor';
    const savedSig = currentUser ? window.SamuStorage.getSavedSignature(currentUser.username) : '';
    const lastKm = window.SamuStorage.getLastKmFinal() || '';

    const blank = {
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
      vitimaTelefone: '',
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
      _cpfAutoFilled: '',

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
      enfermagemSlot1User: isEnf ? currentUser.username : '',

      enfermagem2Nome: '',
      enfermagem2Coren: '',
      sigEnfermagem2: '',
      enfermagemSlot2User: '',

      condutorNome: isCond ? currentUser.name : '',
      sigCondutor: isCond ? savedSig : '',
      condutorSlot1User: isCond ? currentUser.username : '',

      condutor2Nome: '',
      sigCondutor2: '',
      condutorSlot2User: ''
    };

    const crew = currentUser ? window.SamuStorage.getActiveCrewForUser(currentUser.username) : null;
    if (crew) {
      applyCrewToFichaState(blank, crew, true);
    }
    return blank;
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

    if (merged.vitimaTelefone) {
      merged.vitimaTelefone = formatPhoneBR(merged.vitimaTelefone, true);
    }
    if (merged.ocorrenciaContato && /^\s*[\d()\s+-]+\s*$/.test(String(merged.ocorrenciaContato))) {
      merged.ocorrenciaContato = formatPhoneBR(merged.ocorrenciaContato, true) || merged.ocorrenciaContato;
    }

    // Setor Recomendado e Setor Admitido aceitam apenas 1 seleção por vez
    ['setorRecomendado', 'setorAdmitido'].forEach(sk => {
      const v = merged[sk];
      if (Array.isArray(v)) {
        const clean = v.map(x => String(x || '').trim()).filter(Boolean);
        merged[sk] = clean.length > 0 ? [clean[clean.length - 1]] : [];
      } else if (typeof v === 'string' && v.trim()) {
        merged[sk] = [v.trim()];
      } else {
        merged[sk] = [];
      }
    });

    return merged;
  }

  function hasMeaningfulFichaData(d) {
    if (!d) return false;
    const defaultHosp = (window.SamuStorage.getSettings().defaultHospital || 'HBSA').toUpperCase();
    const customDestino = d.destino && String(d.destino).trim().toUpperCase() !== defaultHosp;
    if (d.vitimaNome || d.vitimaCpf || d.vitimaTelefone || d.motivoSolicitacao || d.ocorrenciaEndereco || d.kmFinal || d.descricaoCena || d.relatorioEnfermagem || customDestino || d.recebidoPorNome) return true;
    if ((d.locaisOcorrencia && d.locaisOcorrencia.length) || (d.tiposAtendimento && d.tiposAtendimento.length) || (d.procedimentos && d.procedimentos.length)) return true;
    if ((d.medicamentosSelecionados && d.medicamentosSelecionados.length) || d.medicamentosOutro || (d.alergiasSelecionadas && d.alergiasSelecionadas.length) || d.alergiasOutro) return true;
    const h = d.horarios || {};
    return Object.keys(h).some(k => Boolean(h[k]));
  }

  function applySavedAvariasToCondutorState(state, forceOverwrite) {
    const d = state || condutorState;
    if (!d) return d;
    const vid = d.viaturaId || 'master_29';
    const oPlaca = d.outraPlaca || '';
    const isDiurno = d.turnoAtivo !== 'NOTURNO';
    const activeKey = isDiurno ? 'avariasDiurno' : 'avariasNoturno';
    const inactiveKey = isDiurno ? 'avariasNoturno' : 'avariasDiurno';
    const inactiveItems = isDiurno ? d.itensNoturno : d.itensDiurno;

    const avMap = window.SamuStorage.getViaturaAvariasMap ? window.SamuStorage.getViaturaAvariasMap() : {};
    const vKey = window.SamuStorage.getViaturaStorageKey ? window.SamuStorage.getViaturaStorageKey(vid, oPlaca) : vid;
    const hasSavedEntry = Object.prototype.hasOwnProperty.call(avMap, vKey);
    const savedMarks = window.SamuStorage.getViaturaAvarias ? window.SamuStorage.getViaturaAvarias(vid, oPlaca) : [];

    if (forceOverwrite || hasSavedEntry) {
      d[activeKey] = savedMarks;
      if (forceOverwrite && (!inactiveItems || Object.keys(inactiveItems).length === 0)) {
        d[inactiveKey] = [];
      }
    } else if (!Array.isArray(d[activeKey]) || d[activeKey].length === 0) {
      d[activeKey] = savedMarks;
    } else if (Array.isArray(d[activeKey]) && d[activeKey].length > 0 && window.SamuStorage.saveViaturaAvarias) {
      // Migra marcações de rascunho anterior para a memória permanente desta viatura
      window.SamuStorage.saveViaturaAvarias(vid, oPlaca, d[activeKey], currentUser ? currentUser.username : '');
    }
    return d;
  }

  function applySharedDailyToCondutorState(state, opts) {
    const d = state || condutorState;
    if (!d || !d.data || !window.SamuStorage.getSharedDailyChecklist) return d;
    const replaceOtherShift = Boolean(opts && opts.replaceOtherShift);
    const isDiurno = d.turnoAtivo !== 'NOTURNO';

    if (replaceOtherShift) {
      if (!isDiurno) {
        d.condutorDiurno = '';
        d.itensDiurno = {};
        d.obsDiurno = '';
        d.sigCondutorDiurno = '';
        d.avariasDiurno = [];
      } else {
        d.condutorNoturno = '';
        d.itensNoturno = {};
        d.obsNoturno = '';
        d.sigCondutorNoturno = '';
        d.avariasNoturno = [];
      }
      if (d._abastFromShared) {
        d.abastRealizado = '';
        d.abastLitros = '';
        d.abastHora = '';
        d.abastKm = '';
        d.abastAss = '';
        d.sigAbastecimento = '';
        d._abastFromShared = false;
      }
    }

    const shared = window.SamuStorage.getSharedDailyChecklist('condutor', d.data, d.viaturaId || 'master_29', d.outraPlaca || '');
    if (!shared) return d;

    if (!isDiurno) {
      if (shared.itensDiurno && Object.keys(shared.itensDiurno).length > 0) {
        d.itensDiurno = Object.assign({}, shared.itensDiurno, d.itensDiurno || {});
      }
      if (shared.condutorDiurno && (!d.condutorDiurno || replaceOtherShift)) {
        d.condutorDiurno = shared.condutorDiurno;
      }
      if (shared.obsDiurno && (!d.obsDiurno || replaceOtherShift)) {
        d.obsDiurno = shared.obsDiurno;
      }
      if (shared.sigCondutorDiurno && (!d.sigCondutorDiurno || replaceOtherShift)) {
        d.sigCondutorDiurno = shared.sigCondutorDiurno;
      }
      if (Array.isArray(shared.avariasDiurno) && shared.avariasDiurno.length > 0 && (!Array.isArray(d.avariasDiurno) || d.avariasDiurno.length === 0 || replaceOtherShift)) {
        d.avariasDiurno = JSON.parse(JSON.stringify(shared.avariasDiurno));
      }
      if (shared.abastRealizado === 'SIM' && (!d.abastRealizado || d._abastFromShared)) {
        d.abastRealizado = 'SIM';
        d.abastLitros = shared.abastLitros || '';
        d.abastHora = shared.abastHora || '';
        d.abastKm = shared.abastKm || '';
        d.abastAss = shared.abastAss || '';
        d.sigAbastecimento = shared.sigAbastecimento || '';
        d._abastFromShared = true;
      }
    } else {
      if (shared.itensNoturno && Object.keys(shared.itensNoturno).length > 0) {
        d.itensNoturno = Object.assign({}, shared.itensNoturno, d.itensNoturno || {});
      }
      if (shared.condutorNoturno && (!d.condutorNoturno || replaceOtherShift)) {
        d.condutorNoturno = shared.condutorNoturno;
      }
      if (shared.obsNoturno && (!d.obsNoturno || replaceOtherShift)) {
        d.obsNoturno = shared.obsNoturno;
      }
      if (shared.sigCondutorNoturno && (!d.sigCondutorNoturno || replaceOtherShift)) {
        d.sigCondutorNoturno = shared.sigCondutorNoturno;
      }
      if (Array.isArray(shared.avariasNoturno) && shared.avariasNoturno.length > 0 && (!Array.isArray(d.avariasNoturno) || d.avariasNoturno.length === 0 || replaceOtherShift)) {
        d.avariasNoturno = JSON.parse(JSON.stringify(shared.avariasNoturno));
      }
    }
    return d;
  }

  function syncActiveShiftFieldsInEnfermagem(state) {
    const d = state || enfermagemState;
    if (!d) return d;
    if (d.turno === 'NOITE') {
      d.responsavelNoiteNome = d.responsavelNome || '';
      d.responsavelNoiteCoren = d.responsavelCoren || '';
      d.obsNoitePagina1 = d.obsPagina1 || '';
      d.obsNoitePagina2 = d.obsPagina2 || '';
      d.sigEnfermagemNoite = d.sigEnfermagem || '';
    } else {
      d.responsavelDiaNome = d.responsavelNome || '';
      d.responsavelDiaCoren = d.responsavelCoren || '';
      d.obsDiaPagina1 = d.obsPagina1 || '';
      d.obsDiaPagina2 = d.obsPagina2 || '';
      d.sigEnfermagemDia = d.sigEnfermagem || '';
    }
    return d;
  }

  function applySharedDailyToEnfermagemState(state, opts) {
    const d = state || enfermagemState;
    if (!d || !d.data || !window.SamuStorage.getSharedDailyChecklist) return d;
    const replaceOtherShift = Boolean(opts && opts.replaceOtherShift);
    const isNoite = d.turno === 'NOITE';

    if (replaceOtherShift) {
      if (isNoite) {
        d.itensDia = {};
        d.responsavelDiaNome = '';
        d.responsavelDiaCoren = '';
        d.obsDiaPagina1 = '';
        d.obsDiaPagina2 = '';
        d.sigEnfermagemDia = '';
      } else {
        d.itensNoite = {};
        d.responsavelNoiteNome = '';
        d.responsavelNoiteCoren = '';
        d.obsNoitePagina1 = '';
        d.obsNoitePagina2 = '';
        d.sigEnfermagemNoite = '';
      }
    }

    const shared = window.SamuStorage.getSharedDailyChecklist('enfermagem', d.data);
    if (!shared) return d;

    if (isNoite) {
      if (shared.itensDia && Object.keys(shared.itensDia).length > 0) {
        d.itensDia = Object.assign({}, shared.itensDia, d.itensDia || {});
      }
      if (shared.responsavelDiaNome && (!d.responsavelDiaNome || replaceOtherShift)) {
        d.responsavelDiaNome = shared.responsavelDiaNome;
      }
      if (shared.responsavelDiaCoren && (!d.responsavelDiaCoren || replaceOtherShift)) {
        d.responsavelDiaCoren = shared.responsavelDiaCoren;
      }
      if (shared.obsDiaPagina1 && (!d.obsDiaPagina1 || replaceOtherShift)) {
        d.obsDiaPagina1 = shared.obsDiaPagina1;
      }
      if (shared.obsDiaPagina2 && (!d.obsDiaPagina2 || replaceOtherShift)) {
        d.obsDiaPagina2 = shared.obsDiaPagina2;
      }
      if (shared.sigEnfermagemDia && (!d.sigEnfermagemDia || replaceOtherShift)) {
        d.sigEnfermagemDia = shared.sigEnfermagemDia;
      }
    } else {
      if (shared.itensNoite && Object.keys(shared.itensNoite).length > 0) {
        d.itensNoite = Object.assign({}, shared.itensNoite, d.itensNoite || {});
      }
      if (shared.responsavelNoiteNome && (!d.responsavelNoiteNome || replaceOtherShift)) {
        d.responsavelNoiteNome = shared.responsavelNoiteNome;
      }
      if (shared.responsavelNoiteCoren && (!d.responsavelNoiteCoren || replaceOtherShift)) {
        d.responsavelNoiteCoren = shared.responsavelNoiteCoren;
      }
      if (shared.obsNoitePagina1 && (!d.obsNoitePagina1 || replaceOtherShift)) {
        d.obsNoitePagina1 = shared.obsNoitePagina1;
      }
      if (shared.obsNoitePagina2 && (!d.obsNoitePagina2 || replaceOtherShift)) {
        d.obsNoitePagina2 = shared.obsNoitePagina2;
      }
      if (shared.sigEnfermagemNoite && (!d.sigEnfermagemNoite || replaceOtherShift)) {
        d.sigEnfermagemNoite = shared.sigEnfermagemNoite;
      }
    }
    return d;
  }

  function isDaytimeChecklistWaitingNightPrint(record) {
    if (!record || (record.type !== 'checklist_condutor' && record.type !== 'checklist_enfermagem')) return false;
    const cfg = window.SamuStorage.getRemotePrintConfig ? window.SamuStorage.getRemotePrintConfig() : null;
    if (!cfg || !cfg.autoPrintChecklists || cfg.checklistPrintShift === 'all') return false;
    return !(window.SamuStorage.isNightShiftChecklist && window.SamuStorage.isNightShiftChecklist(record));
  }

  function createEmptyCondutor() {
    const h = new Date().getHours();
    const isDiurno = (h >= 6 && h < 18);
    const uname = currentUser ? currentUser.name : '';
    const savedSig = currentUser ? window.SamuStorage.getSavedSignature(currentUser.username) : '';

    const blankCond = {
      data: todayISO(),
      turnoAtivo: isDiurno ? 'DIURNO' : 'NOTURNO',
      viaturaId: 'master_29',
      outraPlaca: '',
      condutorDiurno: isDiurno ? uname : '',
      condutorNoturno: !isDiurno ? uname : '',
      abastRealizado: '',
      abastLitros: '',
      abastHora: '',
      abastKm: '',
      abastAss: '',
      sigAbastecimento: '',
      _abastFromShared: false,
      itensDiurno: {},
      itensNoturno: {},
      avariasDiurno: [],
      avariasNoturno: [],
      obsDiurno: '',
      obsNoturno: '',
      sigCondutorDiurno: isDiurno ? savedSig : '',
      sigCondutorNoturno: !isDiurno ? savedSig : ''
    };
    applySavedAvariasToCondutorState(blankCond, true);
    return applySharedDailyToCondutorState(blankCond, { replaceOtherShift: false });
  }

  function createEmptyEnfermagem() {
    const h = new Date().getHours();
    const isDia = (h >= 6 && h < 18);
    const savedSig = currentUser ? window.SamuStorage.getSavedSignature(currentUser.username) : '';
    const uname = currentUser ? currentUser.name : '';
    const ucoren = currentUser ? (currentUser.coren || currentUser.councilId || '') : '';

    const blankEnf = {
      data: todayISO(),
      turno: isDia ? 'DIA' : 'NOITE',
      responsavelNome: uname,
      responsavelCoren: ucoren,
      responsavelDiaNome: isDia ? uname : '',
      responsavelDiaCoren: isDia ? ucoren : '',
      responsavelNoiteNome: !isDia ? uname : '',
      responsavelNoiteCoren: !isDia ? ucoren : '',
      itensDia: {},
      itensNoite: {},
      obsPagina1: '',
      obsPagina2: '',
      obsDiaPagina1: '',
      obsDiaPagina2: '',
      obsNoitePagina1: '',
      obsNoitePagina2: '',
      sigEnfermagem: savedSig,
      sigEnfermagemDia: isDia ? savedSig : '',
      sigEnfermagemNoite: !isDia ? savedSig : ''
    };
    return applySharedDailyToEnfermagemState(blankEnf, { replaceOtherShift: false });
  }

  /* ===================== VALIDAÇÃO OBRIGATÓRIA 100% DOS CHECK LISTS ===================== */
  function getCondutorAbastStatus(d) {
    if (!d) return '';
    if (d.abastRealizado === 'NAO' || d.abastRealizado === 'SIM') return d.abastRealizado;
    if ([d.abastLitros, d.abastHora, d.abastKm, d.abastAss, d.sigAbastecimento].some(v => String(v || '').trim() !== '')) {
      return 'SIM';
    }
    return '';
  }

  function validateCondutorChecklist(d) {
    const data = d || {};
    const errors = [];
    const invalidFields = new Set();
    const missingItemIds = new Set();
    let firstMissingDomId = '';

    const markField = (fieldKey, domId, msg) => {
      invalidFields.add(fieldKey);
      errors.push(msg);
      if (!firstMissingDomId && domId) firstMissingDomId = domId;
    };

    const isDiurno = data.turnoAtivo !== 'NOTURNO';
    if (!String(data.data || '').trim()) {
      markField('data', 'cond-field-data', 'Data do plantão');
    }
    if (data.turnoAtivo !== 'DIURNO' && data.turnoAtivo !== 'NOTURNO') {
      markField('turnoAtivo', 'cond-field-turno', 'Turno sendo preenchido');
    }
    if (!String(data.viaturaId || '').trim()) {
      markField('viaturaId', 'cond-field-viatura', 'Seleção da Viatura');
    } else if (data.viaturaId === 'outra' && !String(data.outraPlaca || '').trim()) {
      markField('outraPlaca', 'cond-field-outra-placa', 'Modelo / Placa da Outra Viatura');
    }

    if (isDiurno) {
      if (!String(data.condutorDiurno || '').trim()) {
        markField('condutorDiurno', 'cond-field-nome-diurno', 'Nome do Condutor Diurno');
      }
    } else {
      if (!String(data.condutorNoturno || '').trim()) {
        markField('condutorNoturno', 'cond-field-nome-noturno', 'Nome do Condutor Noturno');
      }
    }

    const abastStatus = getCondutorAbastStatus(data);
    if (!abastStatus) {
      markField('abastRealizado', 'cond-field-abast-status', 'Abastecimento: informe se houve abastecimento (Não ou Sim)');
    } else if (abastStatus === 'SIM') {
      if (!String(data.abastLitros || '').trim()) markField('abastLitros', 'cond-field-abast-l', 'Abastecimento: Litros');
      if (!String(data.abastHora || '').trim()) markField('abastHora', 'cond-field-abast-h', 'Abastecimento: Hora');
      if (!String(data.abastKm || '').trim()) markField('abastKm', 'cond-field-abast-km', 'Abastecimento: KM');
      if (!String(data.sigAbastecimento || data.abastAss || '').trim()) {
        markField('sigAbastecimento', 'cond-field-abast-sig', 'Abastecimento: Assinatura na tela (com o dedo)');
      }
    }

    const itensMap = (isDiurno ? data.itensDiurno : data.itensNoturno) || {};
    const allItems = window.SAMU_SCHEMA.condutorLeftItems.concat(window.SAMU_SCHEMA.condutorRightItems);
    const missingNames = [];
    allItems.forEach(it => {
      if (!String(itensMap[it.id] || '').trim()) {
        missingItemIds.add(it.id);
        missingNames.push(it.name);
        if (!firstMissingDomId) firstMissingDomId = `cond-item-row-${it.id}`;
      }
    });
    if (missingNames.length > 0) {
      const sample = missingNames.slice(0, 3).join(', ');
      errors.push(`${missingNames.length} item(ns) da viatura sem conferência (${sample}${missingNames.length > 3 ? '...' : ''})`);
    }

    const obsTurno = isDiurno ? data.obsDiurno : data.obsNoturno;
    if (!String(obsTurno || '').trim()) {
      markField('obsTurno', 'cond-field-obs', `Observações ${isDiurno ? 'Diurno' : 'Noturna'}`);
    }

    const sigTurno = isDiurno ? data.sigCondutorDiurno : data.sigCondutorNoturno;
    if (!String(sigTurno || '').trim()) {
      markField('sigTurno', 'cond-sig-box', `Assinatura na Tela – Condutor ${isDiurno ? 'Diurno' : 'Noturno'}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      invalidFields,
      missingItemIds,
      firstMissingDomId
    };
  }

  function validateEnfermagemChecklist(d) {
    const data = d || {};
    const errors = [];
    const invalidFields = new Set();
    const missingItemIds = new Set();
    const incompleteSecIdxs = new Set();
    let firstMissingSecIdx = -1;
    let firstMissingDomId = '';

    const markField = (fieldKey, domId, msg) => {
      invalidFields.add(fieldKey);
      errors.push(msg);
      if (!firstMissingDomId && domId) firstMissingDomId = domId;
    };

    const isDia = data.turno !== 'NOITE';
    if (!String(data.data || '').trim()) {
      markField('data', 'enf-field-data', 'Data da checagem');
    }
    if (data.turno !== 'DIA' && data.turno !== 'NOITE') {
      markField('turno', 'enf-field-turno', 'Turno (CK DIA ou CK NOITE)');
    }
    if (!String(data.responsavelNome || '').trim()) {
      markField('responsavelNome', 'enf-field-nome', 'Profissional Enfermagem');
    }
    if (!String(data.responsavelCoren || '').trim()) {
      markField('responsavelCoren', 'enf-field-coren', 'COREN do Profissional');
    }

    const targetMap = (isDia ? data.itensDia : data.itensNoite) || {};
    const sections = window.SAMU_SCHEMA.enfermagemSections;
    let totalMissingItems = 0;
    const secSummaries = [];

    sections.forEach((sec, secIdx) => {
      let secMissing = 0;
      sec.items.forEach(it => {
        if (!String(targetMap[it.id] || '').trim()) {
          missingItemIds.add(it.id);
          incompleteSecIdxs.add(secIdx);
          secMissing++;
          totalMissingItems++;
          if (firstMissingSecIdx === -1) firstMissingSecIdx = secIdx;
          if (!firstMissingDomId) firstMissingDomId = `enf-item-row-${it.id}`;
        }
      });
      if (secMissing > 0) {
        secSummaries.push(`${sec.title} (${secMissing} pendente${secMissing > 1 ? 's' : ''})`);
      }
    });

    if (totalMissingItems > 0) {
      const sampleSecs = secSummaries.slice(0, 3).join(', ');
      errors.push(`${totalMissingItems} material(is) sem conferência em: ${sampleSecs}${secSummaries.length > 3 ? '...' : ''}`);
    }

    if (!String(data.obsPagina1 || '').trim()) {
      markField('obsPagina1', 'enf-field-obs-1', 'OBS – Mochilas (Página 1)');
    }
    if (!String(data.obsPagina2 || '').trim()) {
      markField('obsPagina2', 'enf-field-obs-2', 'OBS – Viatura / Gavetas / Armário (Página 2)');
    }
    if (!String(data.sigEnfermagem || '').trim()) {
      markField('sigEnfermagem', 'enf-sig-box', 'Assinatura e Carimbo Digital na Tela');
    }

    return {
      valid: errors.length === 0,
      errors,
      invalidFields,
      missingItemIds,
      incompleteSecIdxs,
      firstMissingSecIdx,
      firstMissingDomId
    };
  }

  function renderChecklistValidationBannerHtml(val) {
    if (!val || val.valid) return '';
    return `
      <div class="checklist-validation-banner">
        <strong>⚠️ Envio bloqueado: preencha todos os campos do Check List antes de enviar:</strong>
        <ul>
          ${val.errors.map(err => `<li>${escapeHtml(err)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  function scrollToMissingChecklistField(domId) {
    if (!domId) return;
    setTimeout(() => {
      const el = document.getElementById(domId);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 60);
  }

  async function ensureChecklistCompleteBeforeAction(record, actionLabel) {
    if (!record) return false;
    if (record.type === 'checklist_condutor') {
      const val = validateCondutorChecklist(record.data);
      if (val.valid) return true;
      const modal = document.getElementById('pdf-preview-modal');
      if (modal) modal.classList.add('hidden');
      const existing = record.id ? await window.SamuStorage.getRecordById(record.id) : null;
      condutorState = Object.assign(createEmptyCondutor(), JSON.parse(JSON.stringify(record.data || {})));
      if (existing) editingCondutorId = record.id;
      condutorValidationActive = true;
      activeTab = 'condutor';
      renderBottomNav();
      renderCondutorView();
      scrollToMissingChecklistField(val.firstMissingDomId);
      await samuAlert(
        `⚠️ Não é possível ${actionLabel || 'enviar'} o Check List com campos em branco.\n\nFalta preencher:\n• ` +
        val.errors.join('\n• ')
      );
      return false;
    }

    if (record.type === 'checklist_enfermagem') {
      const val = validateEnfermagemChecklist(record.data);
      if (val.valid) return true;
      const modal = document.getElementById('pdf-preview-modal');
      if (modal) modal.classList.add('hidden');
      const existing = record.id ? await window.SamuStorage.getRecordById(record.id) : null;
      enfermagemState = Object.assign(createEmptyEnfermagem(), JSON.parse(JSON.stringify(record.data || {})));
      if (existing) editingEnfermagemId = record.id;
      enfermagemValidationActive = true;
      if (val.firstMissingSecIdx >= 0) {
        activeEnfSectionIdx = val.firstMissingSecIdx;
      }
      activeTab = 'enfermagem';
      renderBottomNav();
      renderEnfermagemView();
      scrollToMissingChecklistField(val.firstMissingDomId);
      await samuAlert(
        `⚠️ Não é possível ${actionLabel || 'enviar'} o Check List de Enfermagem com campos em branco.\n\nFalta preencher:\n• ` +
        val.errors.join('\n• ')
      );
      return false;
    }

    return true;
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
    // - Téc. Enfermagem / Enfermeiro(a) -> Login, Senha, COREN e CPF (+ Nome)
    // - Condutor Socorrista -> Login, Senha e CPF (+ Nome, oculta COREN)
    document.querySelectorAll('[data-reg-role]').forEach(btn => {
      btn.addEventListener('click', () => {
        const role = btn.dataset.regRole;
        const subRole = btn.dataset.regSubrole || (role === 'condutor' ? 'condutor' : 'tecnico');
        document.querySelectorAll('[data-reg-role]').forEach(b => b.classList.toggle('active', b === btn));
        const roleHidden = document.getElementById('reg-role');
        if (roleHidden) roleHidden.value = role;
        const subRoleHidden = document.getElementById('reg-subrole');
        if (subRoleHidden) subRoleHidden.value = subRole;
        const corenWrap = document.getElementById('reg-coren-wrap');
        const corenInp = document.getElementById('reg-coren');
        if (role === 'condutor') {
          if (corenWrap) corenWrap.classList.add('hidden');
          if (corenInp) { corenInp.required = false; corenInp.value = ''; }
        } else {
          if (corenWrap) corenWrap.classList.remove('hidden');
          if (corenInp) {
            corenInp.required = true;
            corenInp.placeholder = subRole === 'enfermeiro' ? 'Ex: COREN-SP 318.420-ENF' : 'Ex: COREN-SP 542.810-TE';
          }
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
          const subRole = (document.getElementById('reg-subrole') && document.getElementById('reg-subrole').value) || (role === 'condutor' ? 'condutor' : 'tecnico');
          const res = await window.SamuStorage.registerUserRequest({
            role,
            subRole,
            name: document.getElementById('reg-name').value.trim(),
            username: document.getElementById('reg-user').value.trim(),
            password: document.getElementById('reg-pass').value,
            coren: role === 'enfermagem' ? document.getElementById('reg-coren').value.trim() : '',
            cpf: document.getElementById('reg-cpf').value.trim()
          });
          const createdUser = res.user.username;
          registerForm.reset();
          const firstRoleBtn = document.querySelector('[data-reg-subrole="tecnico"]');
          if (firstRoleBtn) firstRoleBtn.click();
          switchAuthMode('login');
          document.getElementById('login-user').value = createdUser;
          await samuAlert(
            res.githubSynced
              ? `✅ Cadastro "${createdUser}" enviado para a Central (Google Drive) e salvo na base interna! Assim que o Adm aprovar na aba "Aprovar", seu acesso estará liberado.`
              : `✅ Cadastro "${createdUser}" salvo na Base Interna! O Administrador poderá aprová-lo na aba "Aprovar" (e sincronizará automaticamente com o Google Drive assim que houver internet).`
          );
        } catch (err) {
          samuAlert(err.message || 'Não foi possível concluir o cadastro.');
        } finally {
          btn.disabled = false;
          btn.textContent = '📨 Enviar Cadastro p/ Aprovação do Adm';
        }
      });
    }

    const btnToggleLoginDrive = document.getElementById('btn-toggle-login-drive');
    if (btnToggleLoginDrive) {
      btnToggleLoginDrive.addEventListener('click', () => {
        const box = document.getElementById('login-drive-box');
        if (box) box.classList.toggle('hidden');
      });
    }

    const btnSaveLoginDrive = document.getElementById('btn-save-login-drive');
    if (btnSaveLoginDrive) {
      btnSaveLoginDrive.addEventListener('click', async () => {
        const urlEl = document.getElementById('login-script-url');
        const val = (urlEl && urlEl.value.trim()) || '';
        const ghRepo = (document.getElementById('login-github-repo') && document.getElementById('login-github-repo').value.trim()) || '';
        const ghToken = (document.getElementById('login-github-token') && document.getElementById('login-github-token').value.trim()) || '';
        window.SamuStorage.saveSettings({ scriptUrl: val, githubRepo: ghRepo, githubToken: ghToken });

        if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
          try {
            showToast('Sincronizando com Google Drive...');
            await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: true });
            showToast('✅ Base sincronizada com sucesso!');
          } catch (err) {
            samuAlert('Configuração salva, mas houve erro ao sincronizar: ' + err.message);
          }
          if (window.__samuCheckAppUpdate) {
            window.__samuCheckAppUpdate(false);
          }
        } else {
          showToast('Configurações de conexão salvas neste aparelho!');
        }
        const box = document.getElementById('login-drive-box');
        if (box) box.classList.add('hidden');
      });
    }

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-do-login');
      const u = document.getElementById('login-user').value.trim();
      const p = document.getElementById('login-pass').value;
      btn.disabled = true;
      btn.textContent = 'Autenticando...';
      try {
        const res = await window.SamuStorage.login(u, p);
        await enterSession(res.user, { promptCrew: true });
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
      clearTimeout(crewPushTimer);
      window.SamuStorage.setSession(null);
      currentUser = null;
      activeCrew = null;
      const crewModal = document.getElementById('crew-modal');
      if (crewModal) crewModal.classList.add('hidden');
      const pwModal = document.getElementById('password-modal');
      if (pwModal) pwModal.classList.add('hidden');
      const topCrewBtn = document.getElementById('btn-top-crew');
      if (topCrewBtn) topCrewBtn.classList.add('hidden');
      document.getElementById('app-shell').classList.add('hidden');
      document.getElementById('login-screen').classList.remove('hidden');
      document.getElementById('login-pass').value = '';
    });

    const btnTopCrew = document.getElementById('btn-top-crew');
    if (btnTopCrew) {
      btnTopCrew.addEventListener('click', () => {
        openCrewSelectionModal({ isLoginPrompt: false });
      });
    }

    const btnChangePass = document.getElementById('btn-change-pass');
    if (btnChangePass) {
      btnChangePass.addEventListener('click', () => {
        openChangeOwnPasswordModal();
      });
    }

    // Atalho para o Simulador trocar de perfil em 1 clique
    window.__samuQuickSwitch = async function(target) {
      if (target === 'logout' || target === 'register') {
        clearTimeout(crewPushTimer);
        window.SamuStorage.setSession(null);
        currentUser = null;
        activeCrew = null;
        const crewModal = document.getElementById('crew-modal');
        if (crewModal) crewModal.classList.add('hidden');
        const passModal = document.getElementById('password-modal');
        if (passModal) passModal.classList.add('hidden');
        document.getElementById('app-shell').classList.add('hidden');
        document.getElementById('login-screen').classList.remove('hidden');
        const tabBtn = document.getElementById(target === 'register' ? 'tab-auth-register' : 'tab-auth-login');
        if (tabBtn) tabBtn.click();
        return;
      }
      const map = {
        admin: ['admin', 'samu192'],
        condutor: ['condutor', '1234'],
        condutor2: ['condutor2', '1234'],
        enfermagem: ['enfermagem', '1234'],
        enfermeiro: ['enfermeiro', '1234']
      };
      const creds = map[target];
      if (!creds) return;
      try {
        const res = await window.SamuStorage.login(creds[0], creds[1]);
        await enterSession(res.user, { promptCrew: true });
        showToast(`Simulando visão: ${res.user.name}`);
      } catch (e) {
        const users = window.SamuStorage.getLocalUsers();
        const byUserOrRole = users.find(u => u.username === creds[0]) ||
          users.find(u => target === 'admin' ? window.SamuStorage.isUserAdmin(u) : u.role === target);
        if (byUserOrRole) {
          window.SamuStorage.setSession(byUserOrRole);
          await enterSession(byUserOrRole, { promptCrew: true });
          showToast(`Simulando visão: ${byUserOrRole.name}`);
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
      if (!(await ensureChecklistCompleteBeforeAction(previewCurrentRecord, 'compartilhar / salvar'))) return;
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
      if (!(await ensureChecklistCompleteBeforeAction(previewCurrentRecord, 'imprimir'))) return;
      await window.SamuPDF.printRecord(previewCurrentRecord, previewGeneratedPdf);
    });
    const btnPreviewPrintBase = document.getElementById('btn-preview-print-base');
    if (btnPreviewPrintBase) {
      btnPreviewPrintBase.addEventListener('click', async () => {
        if (!previewCurrentRecord) return;
        await sendRecordToBasePrinter(previewCurrentRecord, previewGeneratedPdf, btnPreviewPrintBase);
      });
    }
    document.getElementById('btn-preview-drive').addEventListener('click', async () => {
      if (!previewCurrentRecord || !previewGeneratedPdf) return;
      if (!(await ensureChecklistCompleteBeforeAction(previewCurrentRecord, 'enviar ao Google Drive'))) return;
      const settings = window.SamuStorage.getSettings();
      if (!settings.scriptUrl) {
        samuAlert('Configure primeiro a URL do Google Apps Script (na aba ⚙️ Base/Drive) para enviar direto ao Google Drive.');
        return;
      }
      if (previewCurrentRecord.type === 'ficha' && previewCurrentRecord.data && !previewCurrentRecord._patientCheckedOnSend) {
        const patCheck = await handlePatientCadastroOnFichaSend(previewCurrentRecord.data);
        if (!patCheck.proceed) {
          if (patCheck.action === 'cancel') {
            const prevModal = document.getElementById('pdf-preview-modal');
            if (prevModal) prevModal.classList.add('hidden');
            if (activeTab === 'ficha') {
              fichaStep = 2;
              renderFichaView();
            }
          }
          return;
        }
        previewCurrentRecord._patientCheckedOnSend = true;
      }
      const btn = document.getElementById('btn-preview-drive');
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      try {
        if (previewCurrentRecord.isDraft || previewCurrentRecord.syncStatus === 'draft') {
          previewCurrentRecord.isDraft = false;
          previewCurrentRecord.syncStatus = 'pending';
        }
        if (previewCurrentRecord.type === 'checklist_condutor' && previewCurrentRecord.data) {
          applySharedDailyToCondutorState(previewCurrentRecord.data, { replaceOtherShift: false });
          if (window.SamuStorage.saveSharedDailyChecklist) {
            await window.SamuStorage.saveSharedDailyChecklist('condutor', previewCurrentRecord.data, currentUser);
          }
          previewGeneratedPdf = await window.SamuPDF.generatePdfForRecord(previewCurrentRecord);
        } else if (previewCurrentRecord.type === 'checklist_enfermagem' && previewCurrentRecord.data) {
          syncActiveShiftFieldsInEnfermagem(previewCurrentRecord.data);
          applySharedDailyToEnfermagemState(previewCurrentRecord.data, { replaceOtherShift: false });
          if (window.SamuStorage.saveSharedDailyChecklist) {
            await window.SamuStorage.saveSharedDailyChecklist('enfermagem', previewCurrentRecord.data, currentUser);
          }
          previewGeneratedPdf = await window.SamuPDF.generatePdfForRecord(previewCurrentRecord);
        }
        const res = await window.SamuStorage.uploadRecordToDrive(previewCurrentRecord, previewGeneratedPdf.base64);
        const delAdmBtn = document.getElementById('btn-preview-delete-admin');
        if (delAdmBtn && currentUser && window.SamuStorage.isUserAdmin(currentUser)) {
          delAdmBtn.classList.remove('hidden');
          delAdmBtn.textContent = '🗑️ Excluir do App e Drive';
        }
        await refreshDraftCount();
        await refreshSyncBadge();
        if (activeTab === 'historico') renderHistoricoView();
        if (res.synced) {
          const waitingNight = !res.printQueued && isDaytimeChecklistWaitingNightPrint(previewCurrentRecord);
          document.getElementById('preview-drive-status').textContent = res.printQueued
            ? '✅ PDF salvo no Google Drive e enviado automaticamente para a Impressora da Base!'
            : (waitingNight
              ? '✅ Turno Diurno salvo no Google Drive! (Imprimirá automaticamente na Base quando o Noturno concluir a folha)'
              : '✅ PDF salvo no Google Drive com sucesso!');
          showToast(res.printQueued
            ? '🖨️ PDF salvo no Drive e enviado p/ Impressora da Base!'
            : (waitingNight
              ? '☀️ Diurno salvo no Drive! Imprimirá na Base quando o Noturno concluir.'
              : 'PDF enviado ao Google Drive!'));
        } else {
          document.getElementById('preview-drive-status').textContent = res.printPendingOffline
            ? '⏳ Sem sinal agora: salvo na fila para enviar ao Drive e imprimir na Base automaticamente.'
            : '⏳ Sem sinal agora: salvo na fila para envio automático.';
          showToast('Salvo na fila offline! Enviará assim que conectar.');
        }
      } finally {
        btn.disabled = false;
        btn.textContent = '☁️ Enviar p/ Drive';
      }
    });

    const btnPrevDelAdmin = document.getElementById('btn-preview-delete-admin');
    if (btnPrevDelAdmin) {
      btnPrevDelAdmin.addEventListener('click', async () => {
        if (!previewCurrentRecord || !previewCurrentRecord.id) return;
        await deleteRecordCompletelyAsAdmin(previewCurrentRecord.id, btnPrevDelAdmin);
      });
    }

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
            samuAlert(
              `⏳ O canal de atualização automática ainda não está liberado publicamente.\n\n` +
              `Rode o atalho PUBLICAR_ATUALIZACAO_GITHUB.bat no computador da Coordenação para publicar a versão pública do instalador (sem precisar de token nos celulares!).`
            );
          } else {
            showToast(`✅ Aplicativo atualizado (v${res.local.apkVersionName} • Rev #${res.local.otaRevision})!`);
          }
        }
      } catch (err) {
        if (interactive) samuAlert('Erro ao verificar atualização no GitHub: ' + err.message);
      }
    };

    window.__samuCheckAppUpdate = runAutoUpdateCheck;

    const btnLoginCheckUpd = document.getElementById('btn-login-check-update');
    if (btnLoginCheckUpd) {
      btnLoginCheckUpd.addEventListener('click', () => runAutoUpdateCheck(true));
    }

    const pullGitHubWheneverOnline = async () => {
      if (!navigator.onLine || !window.SamuStorage.hasGitHubConfigured()) return;
      try {
        await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: window.SamuStorage.getGitHubMeta().dirty });
        if (currentUser) {
          await pullAndApplyCrewFichaChanges({ fromNetwork: true });
          if (!editingCondutorId && condutorState) {
            applySavedAvariasToCondutorState(condutorState, false);
            applySharedDailyToCondutorState(condutorState, { replaceOtherShift: false });
            if (activeTab === 'condutor') {
              const activeEl = document.activeElement;
              const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
              if (!isTyping) renderCondutorView();
            }
          }
          if (!editingEnfermagemId && enfermagemState) {
            applySharedDailyToEnfermagemState(enfermagemState, { replaceOtherShift: false });
            if (activeTab === 'enfermagem') {
              const activeEl = document.activeElement;
              const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
              if (!isTyping) renderEnfermagemView();
            }
          }
          await refreshDraftCount();
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

    // Sincronização instantânea entre abas abertas no mesmo aparelho / Simulador
    window.addEventListener('storage', (ev) => {
      if (!currentUser || !ev || !ev.key) return;
      if (
        ev.key === 'samu_crew_teams_v1' ||
        ev.key === 'samu_shared_fichas_v1' ||
        ev.key === 'samu_users_cache_v1' ||
        ev.key === 'samu_saved_sigs_v1'
      ) {
        pullAndApplyCrewFichaChanges({ fromStorageEvent: true });
        refreshDraftCount();
      } else if (ev.key === 'samu_viatura_avarias_v1') {
        renderBottomNav();
        refreshDraftCount();
        if (activeTab === 'historico') {
          const activeEl = document.activeElement;
          const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
          if (!isTyping) renderHistoricoView();
        }
        if (!editingCondutorId && condutorState) {
          applySavedAvariasToCondutorState(condutorState, true);
          applySharedDailyToCondutorState(condutorState, { replaceOtherShift: false });
          if (activeTab === 'condutor') {
            const activeEl = document.activeElement;
            const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
            if (!isTyping) renderCondutorView();
          }
        }
        if (!editingEnfermagemId && enfermagemState) {
          applySharedDailyToEnfermagemState(enfermagemState, { replaceOtherShift: false });
          if (activeTab === 'enfermagem') {
            const activeEl = document.activeElement;
            const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
            if (!isTyping) renderEnfermagemView();
          }
        }
      }
    });

    // Callback nativo do Android ConnectivityManager assim que o celular pega Wi-Fi ou 4G ou volta do segundo plano
    let lastResumeCheckTs = 0;
    const checkOnResumeOrFocus = () => {
      const now = Date.now();
      if (now - lastResumeCheckTs < 6000) return;
      lastResumeCheckTs = now;
      if (navigator.onLine) {
        pullGitHubWheneverOnline();
      }
    };
    window.__onAndroidNetworkOnline = () => {
      refreshSyncBadge();
      pullGitHubWheneverOnline();
      triggerBackgroundSync(false);
    };
    window.__onAndroidAppResume = checkOnResumeOrFocus;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkOnResumeOrFocus();
    });

    // Consulta inicial ao GitHub na abertura do APK e checagem periódica automática quando online
    pullGitHubWheneverOnline();
    setInterval(() => {
      if (!document.hidden && navigator.onLine) {
        pullGitHubWheneverOnline();
      }
    }, 60000);

    // Sincronização ultra-rápida (a cada 2.5s na aba Ficha) entre os celulares da equipe durante o preenchimento
    let crewTickCounter = 0;
    setInterval(async () => {
      if (!currentUser || !window.SamuStorage.hasOperationalRole(currentUser) || document.hidden || !navigator.onLine) return;
      if (!window.SamuStorage.hasGitHubConfigured()) return;
      if (crewPushInFlight) return;
      crewTickCounter++;
      // Sem vínculo ativo: checa a cada ~20s p/ detectar vínculo feito pelo colega; vinculado fora da aba Ficha: ~7.5s; na aba Ficha: 2.5s!
      if (!activeCrew) {
        if (crewTickCounter % 8 !== 0) return;
      } else if (activeTab !== 'ficha') {
        if (crewTickCounter % 3 !== 0) return;
      }
      try {
        await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: window.SamuStorage.getGitHubMeta().dirty });
        await pullAndApplyCrewFichaChanges({ fromNetwork: true });
        await refreshDraftCount();
        renderBottomNav();
        await refreshSyncBadge();
      } catch (e) {}
    }, 2500);

    const existingSession = window.SamuStorage.getSession();
    if (existingSession) {
      enterSession(existingSession, { promptCrew: false });
    }

    const mainViewEl = document.getElementById('main-view');
    if (mainViewEl) {
      disableExternalAutofillInContainer(mainViewEl);
      tintRenderedSignatureImages(mainViewEl);
      if (typeof MutationObserver === 'function') {
        const autofillObserver = new MutationObserver(() => {
          disableExternalAutofillInContainer(mainViewEl);
          tintRenderedSignatureImages(mainViewEl);
        });
        autofillObserver.observe(mainViewEl, { childList: true, subtree: true });
      }
    }
  }

  /* ===================== TINTA AZUL DE CANETA NAS ASSINATURAS SALVAS E NA TELA ===================== */
  const blueSigCache = new Map();

  function tintSignatureCached(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      return Promise.resolve(dataUrl || '');
    }
    if (blueSigCache.has(dataUrl)) {
      return Promise.resolve(blueSigCache.get(dataUrl));
    }
    if (!window.SamuSignature || typeof window.SamuSignature.tintDataUrlBlue !== 'function') {
      return Promise.resolve(dataUrl);
    }
    return window.SamuSignature.tintDataUrlBlue(dataUrl).then(tinted => {
      const out = tinted || dataUrl;
      blueSigCache.set(dataUrl, out);
      blueSigCache.set(out, out);
      return out;
    }).catch(() => dataUrl);
  }

  function tintRenderedSignatureImages(rootEl) {
    const scope = rootEl || document;
    scope.querySelectorAll('.sig-preview-box img').forEach(img => {
      const src = img.getAttribute('src') || '';
      if (!src.startsWith('data:image/')) return;
      if (blueSigCache.has(src)) {
        const cached = blueSigCache.get(src);
        if (cached && cached !== src) img.setAttribute('src', cached);
        return;
      }
      tintSignatureCached(src).then(tinted => {
        if (tinted && tinted !== src && img.getAttribute('src') === src) {
          img.setAttribute('src', tinted);
        }
      });
    });
  }

  async function upgradeExistingSignaturesToBlueInk() {
    if (!window.SamuSignature || typeof window.SamuSignature.tintDataUrlBlue !== 'function') return;
    try {
      if (currentUser && currentUser.username) {
        const saved = window.SamuStorage.getSavedSignature(currentUser.username);
        if (saved) {
          const tinted = await tintSignatureCached(saved);
          if (tinted && tinted !== saved) {
            window.SamuStorage.savePersonalSignature(currentUser.username, tinted);
          }
        }
      }
      if (activeCrew) {
        for (const list of [activeCrew.membersDetailed, activeCrew.teammates, activeCrew.nursingSlots, activeCrew.driverSlots]) {
          if (!Array.isArray(list)) continue;
          for (const m of list) {
            if (m && m.savedSignature) {
              m.savedSignature = await tintSignatureCached(m.savedSignature);
            }
          }
        }
      }
      if (fichaState) {
        for (const k of ['sigTermo', 'sigRecebido', 'sigEnfermagem', 'sigEnfermagem2', 'sigCondutor', 'sigCondutor2']) {
          if (fichaState[k]) {
            fichaState[k] = await tintSignatureCached(fichaState[k]);
          }
        }
      }
      if (condutorState) {
        for (const k of ['sigCondutorDiurno', 'sigCondutorNoturno', 'sigAbastecimento']) {
          if (condutorState[k]) {
            condutorState[k] = await tintSignatureCached(condutorState[k]);
          }
        }
      }
      if (enfermagemState && enfermagemState.sigEnfermagem) {
        enfermagemState.sigEnfermagem = await tintSignatureCached(enfermagemState.sigEnfermagem);
      }
      tintRenderedSignatureImages(document);
    } catch (eSig) {}
  }

  /* ===================== EQUIPE DO PLANTÃO (ATÉ 3 MEMBROS) & FICHA COMPARTILHADA ===================== */
  function updateTopbarCrewButton() {
    const btn = document.getElementById('btn-top-crew');
    const txt = document.getElementById('top-crew-text');
    if (!btn || !txt) return;
    if (!currentUser || !window.SamuStorage.hasOperationalRole(currentUser)) {
      btn.classList.add('hidden');
      return;
    }
    btn.classList.remove('hidden');
    activeCrew = window.SamuStorage.getActiveCrewForUser(currentUser.username);
    if (activeCrew && activeCrew.members && activeCrew.members.length >= 2) {
      btn.classList.add('synced');
      btn.classList.remove('pending');
      txt.textContent = `👥 Equipe (${activeCrew.members.length})`;
    } else {
      btn.classList.remove('synced');
      btn.classList.add('pending');
      txt.textContent = '👥 Equipe';
    }
  }

  function resetFichaSyncTracking(stateObj, sessionId, existingFieldTs, isLoadedRecord) {
    const nextSessionId = sessionId || (editingFichaId ? ('sf_rec_' + editingFichaId) : uid('sf'));
    if (nextSessionId !== currentCrewSessionId) {
      pendingCpfSuggestion = null;
      cpfSuggestionDismissedFor = '';
      cpfAutoFilledFromSaved = (stateObj && stateObj._cpfAutoFilled) ? String(stateObj._cpfAutoFilled) : '';
    }
    currentCrewSessionId = nextSessionId;
    currentCrewIsLoadedRecord = Boolean(isLoadedRecord);
    currentFichaFieldTs = Object.assign({}, (existingFieldTs && typeof existingFieldTs === 'object') ? existingFieldTs : {});
    lastSyncedFichaSnapshot = JSON.parse(JSON.stringify(stateObj || {}));
    lastFocusedFichaFieldId = '';
    lastTypedFichaFieldId = '';
  }

  function stampChangedFichaFields(nowMs) {
    if (!fichaState) return;
    const ts = nowMs || Date.now();
    const prev = lastSyncedFichaSnapshot || {};

    Object.keys(fichaState).forEach(k => {
      if (k === 'horarios') return;
      if (JSON.stringify(fichaState[k]) !== JSON.stringify(prev[k])) {
        currentFichaFieldTs[k] = ts;
      }
    });

    const curH = (fichaState.horarios && typeof fichaState.horarios === 'object') ? fichaState.horarios : {};
    const prevH = (prev.horarios && typeof prev.horarios === 'object') ? prev.horarios : {};
    Object.keys(curH).forEach(hk => {
      if (String(curH[hk] || '') !== String(prevH[hk] || '')) {
        currentFichaFieldTs['horarios.' + hk] = ts;
      }
    });

    lastSyncedFichaSnapshot = JSON.parse(JSON.stringify(fichaState));
  }

  let crewDirtySinceLastPush = false;
  let crewPushInFlight = false;
  let crewPushQueuedImmediate = false;
  let crewTypingBurstStartTs = 0;
  let lastFocusedFichaFieldId = '';
  let lastTypedFichaFieldId = '';

  async function runCrewCloudPushNow() {
    clearTimeout(crewPushTimer);
    crewTypingBurstStartTs = 0;
    if (!navigator.onLine || !window.SamuStorage.hasGitHubConfigured()) return;
    if (crewPushInFlight) {
      crewPushQueuedImmediate = true;
      return;
    }
    crewPushInFlight = true;
    crewDirtySinceLastPush = false;
    crewPushQueuedImmediate = false;
    try {
      await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: true });
      await pullAndApplyCrewFichaChanges({ fromNetwork: true });
      await refreshDraftCount();
      await refreshSyncBadge();
    } catch (e) {
      crewDirtySinceLastPush = true;
    } finally {
      crewPushInFlight = false;
      if (crewPushQueuedImmediate || crewDirtySinceLastPush) {
        crewPushQueuedImmediate = false;
        flushCrewCloudPushNow();
      }
    }
  }

  function flushCrewCloudPushNow() {
    clearTimeout(crewPushTimer);
    crewTypingBurstStartTs = 0;
    if (!navigator.onLine || !window.SamuStorage.hasGitHubConfigured()) return;
    crewPushTimer = setTimeout(() => {
      runCrewCloudPushNow();
    }, 50);
  }

  function scheduleCrewCloudPush(opts) {
    crewDirtySinceLastPush = true;
    if (!navigator.onLine || !window.SamuStorage.hasGitHubConfigured()) return;
    if (opts && opts.immediate) {
      flushCrewCloudPushNow();
      return;
    }
    const now = Date.now();
    if (!crewTypingBurstStartTs) crewTypingBurstStartTs = now;
    const elapsed = now - crewTypingBurstStartTs;
    if (elapsed >= 850) {
      flushCrewCloudPushNow();
      return;
    }
    clearTimeout(crewPushTimer);
    crewPushTimer = setTimeout(() => {
      runCrewCloudPushNow();
    }, Math.max(120, 850 - elapsed));
  }

  function applyFichaValuesToDomWithoutStealingFocus(activeEl) {
    const container = document.getElementById('main-view');
    if (!container || activeTab !== 'ficha' || !fichaState) return;
    container.querySelectorAll('[data-f]').forEach(inp => {
      if (inp === activeEl) return;
      const k = inp.dataset.f;
      if (fichaState[k] !== undefined && String(inp.value || '') !== String(fichaState[k] || '')) {
        inp.value = fichaState[k] || '';
        if (k === 'vitimaTelefone') {
          refreshVictimPhoneKindBadge(fichaState.vitimaTelefone);
        }
      }
    });
    container.querySelectorAll('[data-horario]').forEach(inp => {
      if (inp === activeEl) return;
      const hk = inp.dataset.horario;
      const hv = (fichaState.horarios && fichaState.horarios[hk]) || '';
      if (String(inp.value || '') !== String(hv)) {
        inp.value = hv;
      }
    });
    container.querySelectorAll('[data-risco]').forEach(btn => {
      const rId = btn.dataset.risco;
      const rObj = (window.SAMU_SCHEMA.riscos || []).find(r => r.id === rId);
      if (!rObj) return;
      const sel = fichaState.risco === rId;
      btn.style.background = sel ? rObj.color : rObj.bg;
      btn.style.borderColor = rObj.color;
      btn.style.color = sel ? '#fff' : rObj.color;
    });
    container.querySelectorAll('[data-arr]').forEach(btn => {
      const arr = Array.isArray(fichaState[btn.dataset.arr]) ? fichaState[btn.dataset.arr] : [];
      btn.classList.toggle('selected', arr.includes(btn.dataset.val));
    });
    container.querySelectorAll('[data-yn]').forEach(btn => {
      const curVal = fichaState[btn.dataset.yn] || '';
      const targetVal = btn.dataset.val;
      if (targetVal === 'SIM') btn.classList.toggle('active-yes', curVal === 'SIM');
      else if (targetVal === 'NAO') btn.classList.toggle('active-no', curVal === 'NAO');
    });
    container.querySelectorAll('[data-pupil]').forEach(card => {
      card.classList.toggle('selected', fichaState[card.dataset.pupil] === card.dataset.val);
    });
    container.querySelectorAll('[data-burn]').forEach(btn => {
      const burns = Array.isArray(fichaState.burnZonesSelected) ? fichaState.burnZonesSelected : [];
      btn.classList.toggle('active', burns.includes(btn.dataset.burn));
    });
    if (openSelectBoxKey !== 'med' && document.getElementById('select-box-med')) {
      updateSelectBoxInPlace('med');
    }
    if (openSelectBoxKey !== 'alergia' && document.getElementById('select-box-alergia')) {
      updateSelectBoxInPlace('alergia');
    }
  }

  async function pullAndApplyCrewFichaChanges(opts) {
    if (!currentUser || !window.SamuStorage.hasOperationalRole(currentUser) || !fichaState) return false;
    const prevCrewId = activeCrew ? activeCrew.crewId : '';
    activeCrew = window.SamuStorage.getActiveCrewForUser(currentUser.username);
    updateTopbarCrewButton();

    if (!activeCrew) {
      if (prevCrewId && activeTab === 'ficha') {
        const ae = document.activeElement;
        const isTyping = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
        if (!isTyping) renderFichaView();
      }
      return false;
    }

    const ws = window.SamuStorage.getCrewWorkspace(activeCrew.crewId);
    if (!ws) return false;

    // Se o colega já finalizou / limpou / salvou+nova esta sessão de ficha, abre uma nova ficha limpa aqui também!
    if (currentCrewSessionId && ws.closedSessions && ws.closedSessions[currentCrewSessionId] && !ws.currentFicha) {
      editingFichaId = null;
      manualShowSecondEnf = false;
      manualShowSecondCond = false;
      fichaState = createEmptyFicha();
      fichaStep = 1;
      resetFichaSyncTracking(fichaState, uid('sf'), {}, false);
      await window.SamuStorage.clearDraft(currentUser.username, 'ficha');
      await refreshDraftCount();
      if (activeTab === 'ficha') renderFichaView();
      showToast('🔄 Ficha anterior salva/finalizada pela equipe! Nova ficha pronta.');
      return true;
    }

    let changed = (prevCrewId !== activeCrew.crewId);

    if (ws.currentFicha && ws.currentFicha.data) {
      const localHasProgress = hasMeaningfulFichaData(fichaState) || Object.keys(currentFichaFieldTs || {}).length > 0;
      const localDoc = localHasProgress
        ? {
            sessionId: currentCrewSessionId || ws.currentFicha.sessionId,
            recordId: editingFichaId || '',
            isLoadedRecord: currentCrewIsLoadedRecord,
            updatedAt: new Date(0).toISOString(),
            updatedBy: currentUser.username,
            updatedByName: currentUser.name,
            fieldTs: currentFichaFieldTs,
            data: fichaState
          }
        : null;

      const mergedDoc = window.SamuStorage.mergeSharedFichaDocs(localDoc, ws.currentFicha, ws.closedSessions);
      if (mergedDoc && mergedDoc.data) {
        applyCrewToFichaState(mergedDoc.data, activeCrew, prevCrewId !== activeCrew.crewId);
        const normalizedMerged = normalizeFichaData(mergedDoc.data);
        const nextEditId = mergedDoc.recordId || null;

        if (
          JSON.stringify(normalizedMerged) !== JSON.stringify(fichaState) ||
          nextEditId !== (editingFichaId || null) ||
          mergedDoc.sessionId !== currentCrewSessionId
        ) {
          fichaState = normalizedMerged;
          editingFichaId = nextEditId;
          resetFichaSyncTracking(fichaState, mergedDoc.sessionId, mergedDoc.fieldTs, mergedDoc.isLoadedRecord);
          if (editingFichaId) {
            window.SamuStorage.saveDraft(currentUser.username, 'ficha', { __editingId: editingFichaId, state: fichaState });
          } else {
            window.SamuStorage.saveDraft(currentUser.username, 'ficha', fichaState);
          }
          changed = true;
        }
      }
    } else if (prevCrewId !== activeCrew.crewId) {
      applyCrewToFichaState(fichaState, activeCrew, true);
      stampChangedFichaFields(Date.now());
      changed = true;
    }

    const delRecsMap = window.SamuStorage.getDeletedRecordsMap ? window.SamuStorage.getDeletedRecordsMap() : {};
    if (editingFichaId && delRecsMap[editingFichaId]) {
      editingFichaId = null;
      fichaState = createEmptyFicha();
      resetFichaSyncTracking(fichaState, uid('sf'), {}, false);
      await window.SamuStorage.clearDraft(currentUser.username, 'ficha');
      changed = true;
    }
    if (editingCondutorId && delRecsMap[editingCondutorId]) {
      editingCondutorId = null;
      condutorState = createEmptyCondutor();
      await window.SamuStorage.clearDraft(currentUser.username, 'condutor');
      if (activeTab === 'condutor') renderCondutorView();
    }
    if (editingEnfermagemId && delRecsMap[editingEnfermagemId]) {
      editingEnfermagemId = null;
      enfermagemState = createEmptyEnfermagem();
      await window.SamuStorage.clearDraft(currentUser.username, 'enfermagem');
      if (activeTab === 'enfermagem') renderEnfermagemView();
    }

    if (changed && activeTab === 'ficha') {
      const ae = document.activeElement;
      const mainView = document.getElementById('main-view');
      const isTypingInMain = Boolean(
        ae && mainView && mainView.contains(ae) &&
        (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') &&
        ae.type !== 'checkbox' && ae.type !== 'radio'
      );
      if (isTypingInMain) {
        applyFichaValuesToDomWithoutStealingFocus(ae);
      } else {
        const y = window.scrollY;
        renderFichaView();
        window.scrollTo(0, y);
      }
    }
    return changed;
  }

  function openCrewSelectionModal(options) {
    if (!currentUser || !window.SamuStorage.hasOperationalRole(currentUser)) return;
    const opts = options || {};
    const modal = document.getElementById('crew-modal');
    const body = document.getElementById('crew-modal-body');
    if (!modal || !body) return;

    activeCrew = window.SamuStorage.getActiveCrewForUser(currentUser.username);
    const allApproved = window.SamuStorage.getLocalUsers().filter(u =>
      u.active !== false && u.status === 'approved' && window.SamuStorage.hasOperationalRole(u)
    );
    const meLower = currentUser.username.toLowerCase();
    const mySubRole = window.SamuStorage.getUserSubRole(currentUser);
    const myRoleLabel = window.SamuStorage.getUserRoleLabel(currentUser);
    const myCoren = currentUser.coren || currentUser.councilId || '';

    const others = allApproved.filter(u => u.username.toLowerCase() !== meLower);
    const condutoresList = others.filter(u => window.SamuStorage.getUserSubRole(u) === 'condutor');
    const enfermagemList = others.filter(u => u.role === 'enfermagem');

    const selectedSet = new Set();
    if (activeCrew && Array.isArray(activeCrew.members)) {
      activeCrew.members.forEach(m => {
        const ml = String(m || '').toLowerCase();
        if (ml && ml !== meLower && others.some(o => o.username.toLowerCase() === ml)) {
          selectedSet.add(ml);
        }
      });
    }

    const renderMemberCard = (u) => {
      const uname = u.username.toLowerCase();
      const isSel = selectedSet.has(uname);
      const sub = window.SamuStorage.getUserSubRole(u);
      const roleLbl = window.SamuStorage.getUserRoleLabel(u);
      const corenTxt = u.role === 'enfermagem' ? (u.coren || u.councilId || '') : '';
      const hasSig = Boolean(window.SamuStorage.getSavedSignature(uname) || u.savedSignature);
      const icon = sub === 'condutor' ? '🚑' : (sub === 'enfermeiro' ? '👩‍⚕️' : '🩺');
      return `
        <button type="button" class="crew-member-option ${isSel ? 'selected' : ''}" data-pick-crew-user="${escapeHtml(uname)}">
          <div class="crew-member-check">${isSel ? '✓' : ''}</div>
          <div class="crew-member-info">
            <strong>${icon} ${escapeHtml(u.name)}</strong>
            <small>
              ${escapeHtml(roleLbl)}${corenTxt ? ` • ${escapeHtml(corenTxt)}` : ''}
              ${hasSig ? ' • <span style="color:#15803d;font-weight:800;">✍️ Assinatura salva</span>' : ''}
            </small>
          </div>
        </button>
      `;
    };

    const drawModalContent = () => {
      const chosenMembers = [currentUser].concat(
        others.filter(u => selectedSet.has(u.username.toLowerCase()))
      );
      const validation = window.SamuStorage.validateCrewSelection(chosenMembers);

      const firstGroupTitle = mySubRole === 'condutor'
        ? '🩺 Com qual Téc. de Enfermagem / Enfermeiro(a) você está trabalhando?'
        : '🚑 Com qual Condutor Socorrista você está trabalhando hoje?';
      const firstGroupItems = mySubRole === 'condutor' ? enfermagemList : condutoresList;

      const secondGroupTitle = mySubRole === 'condutor'
        ? '🚑 2º Condutor Socorrista (opcional — se estiverem em 3 no plantão)'
        : '👩‍⚕️ Outro Profissional de Enfermagem (opcional — p/ equipe em 3: Téc. + Enfermeiro + Condutor)';
      const secondGroupItems = mySubRole === 'condutor' ? condutoresList : enfermagemList;

      body.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:10px;">
          <div>
            <h3 style="margin:0; font-size:1.05rem; color:var(--samu-red-dark);">👥 Equipe do Plantão (${chosenMembers.length}/3)</h3>
            <p style="margin:3px 0 0; font-size:0.79rem; color:var(--muted); line-height:1.35;">
              Selecione com quem você está trabalhando. A <strong>Ficha em preenchimento fica sincronizada</strong> entre vocês e os <strong>nomes, COREN e assinaturas</strong> já entram preenchidos no final da ficha!
            </p>
          </div>
        </div>

        <div class="crew-self-badge">
          <span style="font-size:1.15rem;">${mySubRole === 'condutor' ? '🚑' : (mySubRole === 'enfermeiro' ? '👩‍⚕️' : '🩺')}</span>
          <div>
            <div style="font-size:0.74rem; color:#9a3412; font-weight:800;">LOGADO NESTE APARELHO (VOCÊ):</div>
            <strong>${escapeHtml(currentUser.name)}</strong>
            <span style="font-size:0.77rem; color:#7c2d12;"> • ${escapeHtml(myRoleLabel)}${myCoren ? ` (${escapeHtml(myCoren)})` : ''}</span>
          </div>
        </div>

        ${(activeCrew && activeCrew.teammates && activeCrew.teammates.length > 0) ? `
          <div style="background:#f0fdf4; border:1.5px solid #86efac; border-radius:10px; padding:8px 10px; margin-bottom:10px; font-size:0.79rem; color:#14532d; font-weight:700;">
            🔗 Vinculado atualmente com: <strong>${escapeHtml(activeCrew.teammates.map(t => t.name).join(' + '))}</strong>.
            ${opts.isLoginPrompt ? 'Confirme abaixo para manter ou altere os colegas do plantão.' : ''}
          </div>
        ` : ''}

        <div style="font-size:0.8rem; font-weight:800; color:#1e293b; margin-bottom:6px;">${firstGroupTitle}</div>
        <div class="crew-option-list" style="margin-bottom:10px;">
          ${firstGroupItems.length > 0
            ? firstGroupItems.map(renderMemberCard).join('')
            : `<div style="font-size:0.8rem; color:var(--muted); padding:8px;">Nenhum profissional cadastrado nesta categoria ainda.</div>`}
        </div>

        ${secondGroupItems.length > 0 ? `
          <div style="font-size:0.79rem; font-weight:800; color:#475569; margin-bottom:6px;">${secondGroupTitle}</div>
          <div class="crew-option-list" style="margin-bottom:10px;">
            ${secondGroupItems.map(renderMemberCard).join('')}
          </div>
        ` : ''}

        <div class="crew-composition-box ${validation.valid ? 'valid' : 'invalid'}">
          ${escapeHtml(validation.message)}
          <div style="font-size:0.73rem; font-weight:600; opacity:0.9; margin-top:3px;">
            Formações aceitas: <strong>1 Condutor + 1 Téc./Enfermeiro</strong> (2) • <strong>2 Condutores + 1 Téc./Enfermeiro</strong> (3) • <strong>1 Téc. + 1 Enfermeiro + 1 Condutor</strong> (3).
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:8px; margin-top:12px;">
          <button type="button" class="btn btn-success" id="btn-confirm-crew" ${validation.valid ? '' : 'disabled style="opacity:0.5;cursor:not-allowed;"'}>
            ✅ Confirmar Equipe e Sincronizar Ficha
          </button>
          <div style="display:flex; gap:8px;">
            ${activeCrew ? `
              <button type="button" class="btn btn-outline btn-sm" id="btn-clear-crew" style="flex:1;">🔓 Trabalhar Individual</button>
            ` : ''}
            <button type="button" class="btn btn-secondary btn-sm" id="btn-skip-crew" style="flex:1;">
              ${activeCrew ? 'Fechar' : 'Agora não (Individual)'}
            </button>
          </div>
        </div>
      `;

      body.querySelectorAll('[data-pick-crew-user]').forEach(btn => {
        btn.addEventListener('click', () => {
          const uname = btn.dataset.pickCrewUser;
          if (selectedSet.has(uname)) {
            selectedSet.delete(uname);
          } else {
            if (selectedSet.size >= 2) {
              showToast('⚠️ A equipe pode ter no máximo 3 integrantes (você + 2 colegas). Desmarque um antes de trocar.');
              return;
            }
            selectedSet.add(uname);
          }
          drawModalContent();
        });
      });

      const skipBtn = document.getElementById('btn-skip-crew');
      if (skipBtn) {
        skipBtn.addEventListener('click', () => {
          modal.classList.add('hidden');
        });
      }

      const clearBtn = document.getElementById('btn-clear-crew');
      if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
          window.SamuStorage.clearActiveCrewForUser(currentUser.username);
          activeCrew = null;
          updateTopbarCrewButton();
          modal.classList.add('hidden');
          if (activeTab === 'ficha') renderFichaView();
          if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
            window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: true }).catch(() => {});
          }
          showToast('🔓 Vínculo de equipe encerrado (modo individual).');
        });
      }

      const confirmBtn = document.getElementById('btn-confirm-crew');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
          if (!validation.valid) return;
          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Sincronizando Equipe...';
          try {
            if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
              try {
                await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: false });
              } catch (ePull) {}
            }

            const memberUsernames = [currentUser.username].concat(Array.from(selectedSet));
            activeCrew = window.SamuStorage.setActiveCrewForUsers(memberUsernames, currentUser.username);
            updateTopbarCrewButton();

            // Mescla eventual ficha que o colega já esteja preenchendo com os campos locais e já preenche as assinaturas de toda a equipe!
            const ws = window.SamuStorage.getCrewWorkspace(activeCrew.crewId);
            if (ws && ws.currentFicha && ws.currentFicha.data) {
              const localHasProgress = hasMeaningfulFichaData(fichaState);
              const localDoc = localHasProgress
                ? {
                    sessionId: currentCrewSessionId || ws.currentFicha.sessionId,
                    recordId: editingFichaId || '',
                    isLoadedRecord: currentCrewIsLoadedRecord,
                    updatedAt: new Date().toISOString(),
                    updatedBy: currentUser.username,
                    updatedByName: currentUser.name,
                    fieldTs: currentFichaFieldTs,
                    data: fichaState
                  }
                : null;
              const merged = window.SamuStorage.mergeSharedFichaDocs(localDoc, ws.currentFicha, ws.closedSessions);
              if (merged && merged.data) {
                fichaState = normalizeFichaData(merged.data);
                editingFichaId = merged.recordId || null;
                resetFichaSyncTracking(fichaState, merged.sessionId, merged.fieldTs, merged.isLoadedRecord);
              }
            }

            applyCrewToFichaState(fichaState, activeCrew, true);
            persistFichaDraft();
            await window.SamuStorage.syncAllCrewDraftsToLocalRecords();
            await refreshDraftCount();

            modal.classList.add('hidden');
            renderActiveView();

            if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
              window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: true })
                .then(() => refreshSyncBadge())
                .catch(() => {});
            }

            const partnerNames = (activeCrew.teammates || []).map(t => t.name).join(' + ');
            showToast(`✅ Equipe vinculada com ${partnerNames}! Assinaturas preenchidas e ficha sincronizada.`);
          } catch (err) {
            samuAlert(err.message || 'Erro ao vincular equipe.');
            confirmBtn.disabled = false;
            confirmBtn.textContent = '✅ Confirmar Equipe e Sincronizar Ficha';
          }
        });
      }
    };

    drawModalContent();
    modal.classList.remove('hidden');
  }

  /* ==========================================================================
   * TROCA DE SENHA PELO PRÓPRIO USUÁRIO + REDEFINIÇÃO DE SENHA PELO ADM
   * ========================================================================== */
  function openChangeOwnPasswordModal() {
    if (!currentUser) return;
    const modal = document.getElementById('password-modal');
    const body = document.getElementById('password-modal-body');
    if (!modal || !body) return;

    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px;">
        <div>
          <h3 style="margin:0; font-size:1.05rem; color:var(--navy);">🔑 Trocar Minha Senha</h3>
          <div style="font-size:0.78rem; color:var(--muted); margin-top:2px;">
            Usuário: <strong>${escapeHtml(currentUser.name)}</strong> (<code>${escapeHtml(currentUser.username)}</code>)
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-close-own-pass" style="padding:4px 10px;">✖</button>
      </div>

      <p style="margin:0 0 12px; font-size:0.82rem; color:#334155; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:8px 10px;">
        Digite sua <strong>senha atual</strong> e escolha uma <strong>nova senha</strong> pessoal. Ela sincroniza na hora com o Google Drive para funcionar em qualquer celular da equipe.
      </p>

      <form id="form-change-own-pass" autocomplete="off">
        <div class="field">
          <label>Senha Atual (Antiga)</label>
          <input type="password" id="own-pass-old" placeholder="Digite sua senha atual" required />
        </div>
        <div class="field">
          <label>Nova Senha (mínimo 3 caracteres)</label>
          <input type="password" id="own-pass-new" placeholder="Digite a nova senha" minlength="3" required />
        </div>
        <div class="field" style="margin-bottom:8px;">
          <label>Confirmar Nova Senha</label>
          <input type="password" id="own-pass-confirm" placeholder="Repita a nova senha" minlength="3" required />
        </div>

        <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.8rem; font-weight:700; color:#475569; cursor:pointer; margin-bottom:12px;">
          <input type="checkbox" id="chk-show-own-pass" style="width:16px; height:16px;" />
          👁️ Mostrar senhas digitadas
        </label>

        <div id="own-pass-feedback" class="auth-feedback hidden" style="margin-bottom:10px;"></div>

        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="submit" class="btn btn-success" id="btn-submit-own-pass" style="flex:1;">💾 Salvar Nova Senha</button>
          <button type="button" class="btn btn-secondary" id="btn-cancel-own-pass">Cancelar</button>
        </div>
      </form>
    `;

    const closeModal = () => modal.classList.add('hidden');
    document.getElementById('btn-close-own-pass').addEventListener('click', closeModal);
    document.getElementById('btn-cancel-own-pass').addEventListener('click', closeModal);

    const oldInp = document.getElementById('own-pass-old');
    const newInp = document.getElementById('own-pass-new');
    const confInp = document.getElementById('own-pass-confirm');
    const chkShow = document.getElementById('chk-show-own-pass');
    const fbEl = document.getElementById('own-pass-feedback');

    const showFeedback = (msg, isErr) => {
      if (!fbEl) return;
      fbEl.textContent = msg;
      fbEl.className = 'auth-feedback ' + (isErr ? 'err' : 'ok');
    };

    if (chkShow) {
      chkShow.addEventListener('change', () => {
        const t = chkShow.checked ? 'text' : 'password';
        oldInp.type = t;
        newInp.type = t;
        confInp.type = t;
      });
    }

    document.getElementById('form-change-own-pass').addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldVal = oldInp.value.trim();
      const newVal = newInp.value.trim();
      const confVal = confInp.value.trim();

      if (!oldVal) {
        showFeedback('Informe sua senha atual.', true);
        oldInp.focus();
        return;
      }
      if (newVal.length < 3) {
        showFeedback('A nova senha deve ter pelo menos 3 caracteres.', true);
        newInp.focus();
        return;
      }
      if (newVal !== confVal) {
        showFeedback('A confirmação da nova senha não confere. Digite igual nos dois campos.', true);
        confInp.focus();
        return;
      }

      const btn = document.getElementById('btn-submit-own-pass');
      btn.disabled = true;
      btn.textContent = 'Salvando...';
      try {
        const res = await window.SamuStorage.changeOwnPassword(currentUser.username, oldVal, newVal);
        currentUser.password = res.user.password;
        window.SamuStorage.setSession(currentUser);
        await refreshSyncBadge();
        closeModal();
        if (activeTab === 'aprovacoes') renderAprovacoesView(true);
        else if (activeTab === 'admin') renderAdminView();
        showToast(res.cloudSynced
          ? '✅ Senha alterada e sincronizada com o Google Drive!'
          : '✅ Senha alterada! (Sincronizará com o Google Drive assim que conectar)');
      } catch (err) {
        showFeedback(err.message || 'Não foi possível alterar a senha.', true);
        btn.disabled = false;
        btn.textContent = '💾 Salvar Nova Senha';
      }
    });

    modal.classList.remove('hidden');
    setTimeout(() => { if (oldInp) oldInp.focus(); }, 60);
  }

  function openAdminResetPasswordModal(targetUsername, onAfterSave) {
    if (!currentUser || !window.SamuStorage.isUserAdmin(currentUser)) return;
    const allUsers = window.SamuStorage.getLocalUsers();
    const target = allUsers.find(u => u.username.toLowerCase() === String(targetUsername || '').trim().toLowerCase());
    if (!target) {
      samuAlert('Usuário não encontrado na base.');
      return;
    }

    const modal = document.getElementById('password-modal');
    const body = document.getElementById('password-modal-body');
    if (!modal || !body) return;

    const roleLbl = window.SamuStorage.getUserRoleLabel(target);
    const roleIcon = window.SamuStorage.getUserRoleIcon(target);

    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px;">
        <div>
          <h3 style="margin:0; font-size:1.05rem; color:var(--navy);">🔑 Ver / Editar Senha do Profissional</h3>
          <div style="font-size:0.8rem; color:var(--muted); margin-top:2px;">
            ${roleIcon} <strong>${escapeHtml(target.name)}</strong> (${escapeHtml(roleLbl)})
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-close-adm-pass" style="padding:4px 10px;">✖</button>
      </div>

      <div style="background:#fffbeb; border:1.5px solid #fcd34d; border-radius:10px; padding:10px 12px; margin-bottom:12px; font-size:0.85rem; color:#78350f;">
        <div>👤 Login: <strong><code>${escapeHtml(target.username)}</code></strong></div>
        <div style="margin-top:4px;">🔑 Senha atual cadastrada: <code class="pw-pill" style="font-size:0.95rem;">${escapeHtml(target.password || '(sem senha)')}</code></div>
      </div>

      <form id="form-adm-reset-pass" autocomplete="off">
        <div class="field">
          <label>Nova Senha para "${escapeHtml(target.name)}" (mínimo 3 caracteres)</label>
          <input type="text" id="adm-reset-new-pass" value="${escapeHtml(target.password || '')}" placeholder="Ex: 1234" minlength="3" required />
        </div>
        <div id="adm-pass-feedback" class="auth-feedback hidden" style="margin-bottom:10px;"></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="submit" class="btn btn-success" id="btn-submit-adm-pass" style="flex:1;">💾 Salvar Nova Senha</button>
          <button type="button" class="btn btn-secondary" id="btn-cancel-adm-pass">Fechar</button>
        </div>
      </form>
    `;

    const closeModal = () => modal.classList.add('hidden');
    document.getElementById('btn-close-adm-pass').addEventListener('click', closeModal);
    document.getElementById('btn-cancel-adm-pass').addEventListener('click', closeModal);

    const newInp = document.getElementById('adm-reset-new-pass');
    const fbEl = document.getElementById('adm-pass-feedback');

    document.getElementById('form-adm-reset-pass').addEventListener('submit', async (e) => {
      e.preventDefault();
      const newVal = newInp.value.trim();
      if (newVal.length < 3) {
        if (fbEl) {
          fbEl.textContent = 'A senha deve ter pelo menos 3 caracteres.';
          fbEl.className = 'auth-feedback err';
        }
        newInp.focus();
        return;
      }

      const btn = document.getElementById('btn-submit-adm-pass');
      btn.disabled = true;
      btn.textContent = 'Salvando...';
      try {
        const res = await window.SamuStorage.adminResetUserPassword(target.username, newVal, currentUser);
        if (currentUser && target.username.toLowerCase() === currentUser.username.toLowerCase()) {
          currentUser.password = res.user.password;
          window.SamuStorage.setSession(currentUser);
        }
        await refreshSyncBadge();
        closeModal();
        if (typeof onAfterSave === 'function') onAfterSave();
        showToast(res.cloudSynced
          ? `✅ Senha de "${target.name}" alterada para "${res.user.password}" e sincronizada!`
          : `✅ Senha de "${target.name}" alterada para "${res.user.password}"!`);
      } catch (err) {
        if (fbEl) {
          fbEl.textContent = err.message || 'Erro ao salvar nova senha.';
          fbEl.className = 'auth-feedback err';
        }
        btn.disabled = false;
        btn.textContent = '💾 Salvar Nova Senha';
      }
    });

    modal.classList.remove('hidden');
    setTimeout(() => {
      if (newInp) {
        newInp.focus();
        newInp.select();
      }
    }, 60);
  }

  /* ===================== EDIÇÃO E EXCLUSÃO DE MÉDICOS REGULADORES, RECEBEDORES E PACIENTES ===================== */
  function ensureCatalogModal() {
    let modal = document.getElementById('catalog-edit-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'catalog-edit-modal';
      modal.className = 'sig-modal hidden';
      modal.style.zIndex = '175';
      modal.innerHTML = '<div class="crew-modal-card" id="catalog-edit-modal-body" style="max-width:560px; max-height:92vh; overflow-y:auto;"></div>';
      document.body.appendChild(modal);
    }
    return {
      modal,
      body: document.getElementById('catalog-edit-modal-body')
    };
  }

  function openEditMedicoReguladorModal(medId, onDone) {
    if (!currentUser || !window.SamuStorage.isUserAdmin(currentUser)) return;
    const list = window.SamuStorage.getMedicosReguladores ? window.SamuStorage.getMedicosReguladores() : [];
    const existing = medId ? list.find(m => m.id === medId) : null;
    const { modal, body } = ensureCatalogModal();
    if (!modal || !body) return;

    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:10px;">
        <div>
          <h3 style="margin:0; font-size:1.05rem; color:var(--navy);">👨‍⚕️ ${existing ? 'Editar Médico Regulador' : 'Novo Médico Regulador'}</h3>
          <div style="font-size:0.79rem; color:var(--muted); margin-top:2px;">
            Fica salvo na lista rápida de todas as fichas e sincroniza no Google Drive
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-cat-med-close" style="padding:4px 10px;">✖</button>
      </div>
      <form id="form-cat-medico" autocomplete="off">
        <div class="field">
          <label>No&#8204;me / CRM do Médico Regulador</label>
          <input type="text" id="cat-med-ident" autocomplete="off" value="${escapeHtml(existing ? existing.nome : '')}" placeholder="Ex: Dr. Carlos Eduardo - CRM 124500" required />
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
          <button type="submit" class="btn btn-success" style="flex:1;">💾 Salvar</button>
          ${existing ? `<button type="button" class="btn btn-danger-outline" id="btn-cat-med-del">🗑️ Excluir</button>` : ''}
          <button type="button" class="btn btn-secondary" id="btn-cat-med-cancel">Cancelar</button>
        </div>
      </form>
    `;

    const closeModal = () => modal.classList.add('hidden');
    document.getElementById('btn-cat-med-close').onclick = closeModal;
    document.getElementById('btn-cat-med-cancel').onclick = closeModal;

    const inp = document.getElementById('cat-med-ident');
    document.getElementById('form-cat-medico').addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        const oldNameLow = existing ? String(existing.nome || '').trim().toLowerCase() : '';
        const saved = window.SamuStorage.editMedicoRegulador(existing ? existing.id : '', inp.value);
        if (fichaState && oldNameLow) {
          const curVal = String(fichaState.medicoRegulador || '').trim();
          const curLow = curVal.toLowerCase();
          if (curLow === oldNameLow) {
            fichaState.medicoRegulador = saved.nome;
            persistFichaDraft({ immediate: true });
          } else if (curLow.startsWith(oldNameLow + ' ') || curLow.startsWith(oldNameLow + '/') || curLow.startsWith(oldNameLow + '-')) {
            fichaState.medicoRegulador = saved.nome + curVal.slice(existing.nome.length);
            persistFichaDraft({ immediate: true });
          }
        }
        closeModal();
        if (typeof onDone === 'function') onDone(saved);
        showToast(`✅ Médico Regulador "${saved.nome}" salvo e sincronizado!`);
      } catch (err) {
        samuAlert(err.message || 'Não foi possível salvar o Médico Regulador.');
      }
    });

    const delBtn = document.getElementById('btn-cat-med-del');
    if (delBtn && existing) {
      delBtn.addEventListener('click', async () => {
        if (!(await samuConfirm(`Excluir permanentemente "${existing.nome}" da lista de Médicos Reguladores em todos os aparelhos?`))) return;
        window.SamuStorage.deleteMedicoRegulador(existing.id);
        closeModal();
        if (typeof onDone === 'function') onDone(null);
        showToast(`🗑️ "${existing.nome}" excluído da lista e sincronizado!`);
      });
    }

    modal.classList.remove('hidden');
    setTimeout(() => { if (inp) { inp.focus(); inp.select(); } }, 60);
  }

  function openEditHospitalReceiverModal(recId, onDone) {
    if (!currentUser || !window.SamuStorage.isUserAdmin(currentUser)) return;
    const list = window.SamuStorage.getHospitalReceivers ? window.SamuStorage.getHospitalReceivers() : [];
    const existing = recId ? list.find(r => r.id === recId) : null;
    const defHosp = (window.SamuStorage.getSettings().defaultHospital || 'HBSA').trim() || 'HBSA';
    const { modal, body } = ensureCatalogModal();
    if (!modal || !body) return;

    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:10px;">
        <div>
          <h3 style="margin:0; font-size:1.05rem; color:var(--navy);">🏥 ${existing ? 'Editar Recebedor do Hospital' : 'Novo Recebedor do Hospital'}</h3>
          <div style="font-size:0.79rem; color:var(--muted); margin-top:2px;">
            Profissional que recebe o paciente no hospital (Nome + COREN/CRM)
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-cat-rec-close" style="padding:4px 10px;">✖</button>
      </div>
      <form id="form-cat-receiver" autocomplete="off">
        <div class="field">
          <label>No&#8204;me do Profissional (Hospital)</label>
          <input type="text" id="cat-rec-prof" autocomplete="off" value="${escapeHtml(existing ? existing.nome : '')}" placeholder="Ex: Enf. Patrícia Souza" required />
        </div>
        <div class="grid-2">
          <div class="field">
            <label>COREN / CRM</label>
            <input type="text" id="cat-rec-reg" autocomplete="off" value="${escapeHtml(existing ? (existing.corenCrm || '') : '')}" placeholder="Ex: COREN-SP 412.900" />
          </div>
          <div class="field">
            <label>Hospital / Unidade</label>
            <input type="text" id="cat-rec-hosp" autocomplete="off" value="${escapeHtml(existing ? (existing.hospital || defHosp) : defHosp)}" placeholder="${escapeHtml(defHosp)}" />
          </div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
          <button type="submit" class="btn btn-success" style="flex:1;">💾 Salvar</button>
          ${existing ? `<button type="button" class="btn btn-danger-outline" id="btn-cat-rec-del">🗑️ Excluir</button>` : ''}
          <button type="button" class="btn btn-secondary" id="btn-cat-rec-cancel">Cancelar</button>
        </div>
      </form>
    `;

    const closeModal = () => modal.classList.add('hidden');
    document.getElementById('btn-cat-rec-close').onclick = closeModal;
    document.getElementById('btn-cat-rec-cancel').onclick = closeModal;

    const inpNome = document.getElementById('cat-rec-prof');
    const inpReg = document.getElementById('cat-rec-reg');
    const inpHosp = document.getElementById('cat-rec-hosp');

    document.getElementById('form-cat-receiver').addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        const oldNameLow = existing ? String(existing.nome || '').trim().toLowerCase() : '';
        const saved = window.SamuStorage.editHospitalReceiver(existing ? existing.id : '', {
          nome: inpNome.value,
          corenCrm: inpReg.value,
          hospital: inpHosp.value || defHosp
        });
        if (fichaState && oldNameLow && String(fichaState.recebidoPorNome || '').trim().toLowerCase() === oldNameLow) {
          fichaState.recebidoPorNome = saved.nome;
          fichaState.recebidoCorenCrm = saved.corenCrm || '';
          persistFichaDraft({ immediate: true });
        }
        closeModal();
        if (typeof onDone === 'function') onDone(saved);
        showToast(`✅ Recebedor "${saved.nome}" salvo e sincronizado!`);
      } catch (err) {
        samuAlert(err.message || 'Não foi possível salvar o profissional do hospital.');
      }
    });

    const delBtn = document.getElementById('btn-cat-rec-del');
    if (delBtn && existing) {
      delBtn.addEventListener('click', async () => {
        if (!(await samuConfirm(`Excluir permanentemente "${existing.nome}" da lista rápida do hospital em todos os aparelhos?`))) return;
        window.SamuStorage.deleteHospitalReceiver(existing.id);
        closeModal();
        if (typeof onDone === 'function') onDone(null);
        showToast(`🗑️ "${existing.nome}" excluído da lista do hospital e sincronizado!`);
      });
    }

    modal.classList.remove('hidden');
    setTimeout(() => { if (inpNome) { inpNome.focus(); inpNome.select(); } }, 60);
  }

  function applySavedPatientToCurrentFicha(savedPatient) {
    if (!fichaState || !savedPatient) return;
    const savedDigits = String(savedPatient.vitimaCpf || '').replace(/\D+/g, '');
    const curDigits = String(fichaState.vitimaCpf || '').replace(/\D+/g, '');
    if (!savedDigits || savedDigits !== curDigits) return;
    fichaState.vitimaNome = savedPatient.vitimaNome || '';
    fichaState.vitimaCpf = savedPatient.vitimaCpf || fichaState.vitimaCpf;
    fichaState.vitimaRg = savedPatient.vitimaRg || '';
    fichaState.vitimaCns = savedPatient.vitimaCns || '';
    fichaState.vitimaDn = savedPatient.vitimaDn || '';
    fichaState.vitimaIdade = savedPatient.vitimaIdade || '';
    fichaState.vitimaTelefone = savedPatient.vitimaTelefone ? formatPhoneBR(savedPatient.vitimaTelefone, true) : '';
    fichaState.vitimaCep = savedPatient.vitimaCep || '';
    fichaState.vitimaCidade = savedPatient.vitimaCidade || 'Orlândia';
    fichaState.vitimaBairro = savedPatient.vitimaBairro || '';
    fichaState.vitimaEndereco = savedPatient.vitimaEndereco || '';
    fichaState.vitimaNumero = savedPatient.vitimaNumero || '';
    fichaState.vitimaNaturalidade = savedPatient.vitimaNaturalidade || '';
    fichaState.vitimaPai = savedPatient.vitimaPai || '';
    fichaState.vitimaMae = savedPatient.vitimaMae || '';
    fichaState._cpfAutoFilled = savedDigits;
    cpfAutoFilledFromSaved = savedDigits;
    persistFichaDraft({ immediate: true });
  }

  function openEditPatientCadastroModal(rawCpf, onDone, fallbackSource) {
    if (!currentUser || !window.SamuStorage.isUserAdmin(currentUser)) return;
    const origCpf11 = String(rawCpf || '').replace(/\D+/g, '');
    const patMap = window.SamuStorage.getInternalPatientsMap ? window.SamuStorage.getInternalPatientsMap() : {};
    const existing = (origCpf11.length === 11 && patMap[origCpf11]) ? patMap[origCpf11] : null;
    const seed = existing || fallbackSource || {};
    const { modal, body } = ensureCatalogModal();
    if (!modal || !body) return;

    const initCpf = existing
      ? (existing.vitimaCpf || window.SamuStorage.formatCpf(origCpf11))
      : (origCpf11.length === 11 ? window.SamuStorage.formatCpf(origCpf11) : (seed.vitimaCpf || ''));

    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:10px;">
        <div>
          <h3 style="margin:0; font-size:1.05rem; color:var(--navy);">🪪 ${existing ? 'Editar Pré-Cadastro do Paciente' : 'Novo Pré-Cadastro de Paciente (CPF)'}</h3>
          <div style="font-size:0.79rem; color:var(--muted); margin-top:2px;">
            Edite endere&#8204;ço residencial, documentos ou exclua o pré-cadastro salvo na base SAMU
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-cat-pat-close" style="padding:4px 10px;">✖</button>
      </div>
      <form id="form-cat-patient" autocomplete="off">
        <div class="grid-2">
          <div class="field">
            <label>C&#8204;PF do Paciente</label>
            <input type="text" inputmode="numeric" id="cat-pat-doc1" autocomplete="off" value="${escapeHtml(initCpf)}" placeholder="000.000&#8204;.000-00" required />
          </div>
          <div class="field">
            <label>Data de Nascimento (DN)</label>
            <input type="date" id="cat-pat-nasc" autocomplete="off" value="${escapeHtml(seed.vitimaDn || '')}" />
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label>No&#8204;me Completo do Paciente</label>
            <input type="text" id="cat-pat-ident" autocomplete="off" value="${escapeHtml(seed.vitimaNome || '')}" placeholder="No&#8204;me completo" required />
          </div>
          <div class="field">
            <label>Celu&#8204;lar / Tele&#8204;fone</label>
            <input type="text" inputmode="numeric" id="cat-pat-cnt1" autocomplete="off" value="${escapeHtml(seed.vitimaTelefone ? formatPhoneBR(seed.vitimaTelefone, true) : '')}" placeholder="Ex: (16) 0 0000&#8204; 0000 ou (16) 0000&#8204; 0000" />
          </div>
        </div>
        <div class="grid-3">
          <div class="field">
            <label>Idade</label>
            <input type="text" id="cat-pat-anos" autocomplete="off" value="${escapeHtml(seed.vitimaIdade || '')}" placeholder="Ex: 54 anos" />
          </div>
          <div class="field">
            <label>R&#8204;G</label>
            <input type="text" id="cat-pat-doc2" autocomplete="off" value="${escapeHtml(seed.vitimaRg || '')}" placeholder="R&#8204;G" />
          </div>
          <div class="field">
            <label>Cartão SUS (CNS)</label>
            <input type="text" inputmode="numeric" id="cat-pat-doc3" autocomplete="off" value="${escapeHtml(seed.vitimaCns || '')}" placeholder="CNS" />
          </div>
        </div>

        <div class="section-subtitle" style="margin-top:8px;">Endere&#8204;ço Residencial Pré-Cadastrado</div>
        <div class="grid-2">
          <div class="field">
            <label>C&#8204;EP Residencial</label>
            <div class="input-action-row">
              <input type="text" inputmode="numeric" id="cat-pat-cod" autocomplete="off" value="${escapeHtml(seed.vitimaCep !== undefined ? seed.vitimaCep : '14620-000')}" placeholder="00000&#8204;-000" />
              <button type="button" class="btn-lookup" id="btn-cat-pat-cep">🔍 C&#8204;EP</button>
            </div>
          </div>
          <div class="field">
            <label>Cida&#8204;de</label>
            <input type="text" id="cat-pat-mun" autocomplete="off" value="${escapeHtml(seed.vitimaCidade !== undefined ? seed.vitimaCidade : 'Orlândia')}" placeholder="Orlândia" />
          </div>
        </div>
        <div class="grid-cep-addr">
          <div class="field field-full-phone">
            <label>Bair&#8204;ro</label>
            <input type="text" id="cat-pat-area" autocomplete="off" value="${escapeHtml(seed.vitimaBairro || '')}" placeholder="Bair&#8204;ro" />
          </div>
          <div class="field">
            <label>Endere&#8204;ço (R&#8204;ua / Av.)</label>
            <input type="text" id="cat-pat-loc1" autocomplete="off" value="${escapeHtml(seed.vitimaEndereco || '')}" placeholder="R&#8204;ua / Aveni&#8204;da" />
          </div>
          <div class="field">
            <label>Núme&#8204;ro</label>
            <input type="text" id="cat-pat-loc2" autocomplete="off" value="${escapeHtml(seed.vitimaNumero || '')}" placeholder="N&#8204;º" />
          </div>
        </div>

        <div class="grid-3">
          <div class="field">
            <label>Naturalidade</label>
            <input type="text" id="cat-pat-orig" autocomplete="off" value="${escapeHtml(seed.vitimaNaturalidade || '')}" placeholder="Naturalidade" />
          </div>
          <div class="field">
            <label>No&#8204;me do Pai</label>
            <input type="text" id="cat-pat-fil1" autocomplete="off" value="${escapeHtml(seed.vitimaPai || '')}" placeholder="Opcional" />
          </div>
          <div class="field">
            <label>No&#8204;me da Mãe</label>
            <input type="text" id="cat-pat-fil2" autocomplete="off" value="${escapeHtml(seed.vitimaMae || '')}" placeholder="Opcional" />
          </div>
        </div>

        ${existing ? `
          <label style="display:flex; align-items:center; gap:8px; margin-top:6px; font-size:0.8rem; font-weight:700; color:#475569; cursor:pointer;">
            <input type="checkbox" id="cat-pat-clear-clin" style="width:16px; height:16px;" />
            <span>Limpar também Antecedentes, Medicamentos e Alergias salvos neste C&#8204;PF</span>
          </label>
        ` : ''}

        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:14px;">
          <button type="submit" class="btn btn-success" style="flex:1;">💾 Salvar Pré-Cadastro</button>
          ${existing ? `<button type="button" class="btn btn-danger-outline" id="btn-cat-pat-del">🗑️ Excluir Pré-Cadastro</button>` : ''}
          <button type="button" class="btn btn-secondary" id="btn-cat-pat-cancel">Cancelar</button>
        </div>
      </form>
    `;

    const closeModal = () => modal.classList.add('hidden');
    document.getElementById('btn-cat-pat-close').onclick = closeModal;
    document.getElementById('btn-cat-pat-cancel').onclick = closeModal;

    const cpfInp = document.getElementById('cat-pat-doc1');
    const dnInp = document.getElementById('cat-pat-nasc');
    const ageInp = document.getElementById('cat-pat-anos');
    const telInp = document.getElementById('cat-pat-cnt1');
    const cepInp = document.getElementById('cat-pat-cod');
    const cepBtn = document.getElementById('btn-cat-pat-cep');

    cpfInp.addEventListener('input', () => {
      cpfInp.value = window.SamuStorage.formatCpf(cpfInp.value);
    });
    if (telInp) {
      telInp.addEventListener('input', () => {
        telInp.value = formatPhoneBR(telInp.value, false);
      });
      telInp.addEventListener('blur', () => {
        telInp.value = formatPhoneBR(telInp.value, true);
      });
    }
    dnInp.addEventListener('input', () => {
      const calc = calcAgeFromDn(dnInp.value);
      if (calc) ageInp.value = calc;
    });
    cepInp.addEventListener('input', () => {
      cepInp.value = formatCep(cepInp.value);
    });
    cepBtn.addEventListener('click', async () => {
      const d8 = String(cepInp.value || '').replace(/\D+/g, '');
      if (d8.length !== 8) {
        samuAlert('Digite os 8 números do CEP.');
        return;
      }
      cepBtn.disabled = true;
      cepBtn.textContent = '⏳...';
      try {
        const res = await window.SamuStorage.lookupCepOnline(d8);
        cepInp.value = res.cep || cepInp.value;
        if (res.cidade) document.getElementById('cat-pat-mun').value = res.cidade;
        if (res.bairro) document.getElementById('cat-pat-area').value = res.bairro;
        if (res.endereco) document.getElementById('cat-pat-loc1').value = res.endereco;
        document.getElementById('cat-pat-loc2').focus();
      } catch (err) {
        samuAlert(err.message || 'Não foi possível consultar o CEP online.');
      } finally {
        cepBtn.disabled = false;
        cepBtn.textContent = '🔍 CEP';
      }
    });

    document.getElementById('form-cat-patient').addEventListener('submit', (e) => {
      e.preventDefault();
      const newDigits = String(cpfInp.value || '').replace(/\D+/g, '');
      if (newDigits.length !== 11) {
        samuAlert('Digite os 11 números do CPF do paciente.');
        cpfInp.focus();
        return;
      }
      if (!window.SamuStorage.isValidCpf(newDigits)) {
        samuAlert('O CPF informado possui dígito verificador inválido. Confira os números.');
        cpfInp.focus();
        return;
      }
      try {
        if (existing && origCpf11 && origCpf11 !== newDigits) {
          window.SamuStorage.deletePatientFromInternalDb(origCpf11);
        }
        const clearClinEl = document.getElementById('cat-pat-clear-clin');
        const saved = window.SamuStorage.saveEditedPatientInInternalDb(newDigits, {
          vitimaCpf: newDigits,
          vitimaNome: document.getElementById('cat-pat-ident').value,
          vitimaDn: dnInp.value,
          vitimaIdade: ageInp.value,
          vitimaTelefone: telInp ? formatPhoneBR(telInp.value, true) : '',
          vitimaRg: document.getElementById('cat-pat-doc2').value,
          vitimaCns: document.getElementById('cat-pat-doc3').value,
          vitimaCep: cepInp.value,
          vitimaCidade: document.getElementById('cat-pat-mun').value,
          vitimaBairro: document.getElementById('cat-pat-area').value,
          vitimaEndereco: document.getElementById('cat-pat-loc1').value,
          vitimaNumero: document.getElementById('cat-pat-loc2').value,
          vitimaNaturalidade: document.getElementById('cat-pat-orig').value,
          vitimaPai: document.getElementById('cat-pat-fil1').value,
          vitimaMae: document.getElementById('cat-pat-fil2').value,
          clearClinicalHistory: Boolean(clearClinEl && clearClinEl.checked)
        });
        if (fichaState) {
          const curFichaCpf = String(fichaState.vitimaCpf || '').replace(/\D+/g, '');
          if (curFichaCpf === origCpf11 || curFichaCpf === newDigits) {
            fichaState.vitimaCpf = saved.vitimaCpf;
            applySavedPatientToCurrentFicha(saved);
          }
        }
        closeModal();
        if (typeof onDone === 'function') onDone(saved);
        showToast(`✅ Pré-cadastro de "${saved.vitimaNome}" salvo e sincronizado!`);
      } catch (err) {
        samuAlert(err.message || 'Erro ao salvar pré-cadastro do paciente.');
      }
    });

    const delBtn = document.getElementById('btn-cat-pat-del');
    if (delBtn && existing) {
      delBtn.addEventListener('click', async () => {
        if (!(await samuConfirm(`Excluir permanentemente o pré-cadastro de "${existing.vitimaNome}" (CPF ${existing.vitimaCpf || origCpf11}) da base interna e do Google Drive?`))) return;
        window.SamuStorage.deletePatientFromInternalDb(origCpf11);
        closeModal();
        if (typeof onDone === 'function') onDone(null);
        showToast(`🗑️ Pré-cadastro de "${existing.vitimaNome}" excluído e sincronizado!`);
      });
    }

    modal.classList.remove('hidden');
    setTimeout(() => {
      const focusEl = document.getElementById(existing ? 'cat-pat-loc1' : 'cat-pat-doc1');
      if (focusEl) focusEl.focus();
    }, 60);
  }

  /* ===================== SUGESTÃO DE PREENCHIMENTO PELO CPF E CONFIRMAÇÃO DE ATUALIZAÇÃO AO ENVIAR ===================== */
  const PATIENT_PERSONAL_FIELD_DEFS = [
    { key: 'vitimaNome', label: 'Nome Completo', domId: 'f-vit-ident' },
    { key: 'vitimaDn', label: 'Data de Nascimento (DN)', domId: 'f-vit-nasc', isDate: true },
    { key: 'vitimaIdade', label: 'Idade', domId: 'f-vit-anos' },
    { key: 'vitimaTelefone', label: 'Celular / Telefone', domId: 'f-vit-cnt1', isPhone: true },
    { key: 'vitimaRg', label: 'RG', domId: 'f-vit-doc2' },
    { key: 'vitimaCns', label: 'Cartão SUS (CNS)', domId: 'f-vit-doc3' },
    { key: 'vitimaCep', label: 'CEP Residencial', domId: 'f-vit-cod', isCep: true },
    { key: 'vitimaEndereco', label: 'Endereço Residencial', domId: 'f-vit-loc1' },
    { key: 'vitimaNumero', label: 'Número', domId: 'f-vit-loc2' },
    { key: 'vitimaBairro', label: 'Bairro', domId: 'f-vit-area' },
    { key: 'vitimaCidade', label: 'Cidade', domId: 'f-vit-mun' },
    { key: 'vitimaNaturalidade', label: 'Naturalidade', domId: 'f-vit-orig' },
    { key: 'vitimaPai', label: 'Nome do Pai', domId: 'f-vit-fil1' },
    { key: 'vitimaMae', label: 'Nome da Mãe', domId: 'f-vit-fil2' }
  ];

  function collapseSpaces(val) {
    return String(val == null ? '' : val).trim().replace(/\s+/g, ' ');
  }

  function formatDateBRDisplay(isoStr) {
    const clean = collapseSpaces(isoStr);
    const m = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return clean;
  }

  function normalizePersonalFieldForCompare(key, rawVal) {
    const v = collapseSpaces(rawVal);
    if (!v) return '';
    if (key === 'vitimaCep') return formatCep(v);
    if (key === 'vitimaTelefone') return formatPhoneBR(v, true);
    return v;
  }

  function isUntouchedBlankFormDefaultField(key, fichaData, savedPat, wasAutoFilled) {
    if (!fichaData) return false;
    const hasVictimAddrTyped = Boolean(
      collapseSpaces(fichaData.vitimaEndereco) ||
      collapseSpaces(fichaData.vitimaBairro) ||
      collapseSpaces(fichaData.vitimaNumero)
    );
    if (hasVictimAddrTyped) return false;
    if (key === 'vitimaCep') {
      const fCep = formatCep(fichaData.vitimaCep);
      const sCep = formatCep(savedPat ? savedPat.vitimaCep : '');
      if (fCep === '14620-000' && (!wasAutoFilled || !sCep)) return true;
    }
    if (key === 'vitimaCidade') {
      const fCid = normStr(collapseSpaces(fichaData.vitimaCidade));
      const sCid = normStr(collapseSpaces(savedPat ? savedPat.vitimaCidade : ''));
      if (fCid === 'orlandia' && (!wasAutoFilled || !sCid)) return true;
    }
    return false;
  }

  function fichaAlreadyHasSavedPersonalData(savedPat, targetFicha) {
    if (!savedPat || !targetFicha) return false;
    if (!collapseSpaces(targetFicha.vitimaNome)) return false;
    const savedDn = normalizePersonalFieldForCompare('vitimaDn', savedPat.vitimaDn);
    const fichaDn = normalizePersonalFieldForCompare('vitimaDn', targetFicha.vitimaDn);
    for (const def of PATIENT_PERSONAL_FIELD_DEFS) {
      const k = def.key;
      const sVal = normalizePersonalFieldForCompare(k, savedPat[k]);
      if (!sVal) continue;
      const fVal = normalizePersonalFieldForCompare(k, targetFicha[k]);
      if (k === 'vitimaIdade' && savedDn && fichaDn === savedDn) {
        const autoAge = normalizePersonalFieldForCompare('vitimaIdade', calcAgeFromDn(fichaDn));
        if (fVal === sVal || fVal === autoAge) continue;
      }
      if (fVal !== sVal) return false;
    }
    return true;
  }

  function applyPatientSuggestionToFicha(p, rawCpfDigits) {
    if (!fichaState || !p) return;
    const digits = String(rawCpfDigits || fichaState.vitimaCpf || '').replace(/\D+/g, '');
    const setIfPresent = (stateKey, elId, rawVal) => {
      const val = stateKey === 'vitimaCep'
        ? formatCep(rawVal)
        : (stateKey === 'vitimaTelefone' ? formatPhoneBR(rawVal, true) : collapseSpaces(rawVal));
      if (val !== '') {
        fichaState[stateKey] = val;
        const el = elId ? document.getElementById(elId) : null;
        if (el) el.value = val;
      }
    };

    setIfPresent('vitimaNome', 'f-vit-ident', p.vitimaNome);
    setIfPresent('vitimaDn', 'f-vit-nasc', p.vitimaDn);
    const calcAge = p.vitimaDn ? calcAgeFromDn(p.vitimaDn) : '';
    setIfPresent('vitimaIdade', 'f-vit-anos', calcAge || p.vitimaIdade);
    setIfPresent('vitimaTelefone', 'f-vit-cnt1', p.vitimaTelefone);
    refreshVictimPhoneKindBadge(fichaState.vitimaTelefone);
    setIfPresent('vitimaRg', 'f-vit-doc2', p.vitimaRg);
    setIfPresent('vitimaCns', 'f-vit-doc3', p.vitimaCns);
    setIfPresent('vitimaCep', 'f-vit-cod', p.vitimaCep);
    setIfPresent('vitimaCidade', 'f-vit-mun', p.vitimaCidade);
    setIfPresent('vitimaBairro', 'f-vit-area', p.vitimaBairro);
    setIfPresent('vitimaEndereco', 'f-vit-loc1', p.vitimaEndereco);
    setIfPresent('vitimaNumero', 'f-vit-loc2', p.vitimaNumero);
    setIfPresent('vitimaNaturalidade', 'f-vit-orig', p.vitimaNaturalidade);
    setIfPresent('vitimaPai', 'f-vit-fil1', p.vitimaPai);
    setIfPresent('vitimaMae', 'f-vit-fil2', p.vitimaMae);

    // Preenche histórico clínico salvo caso ainda esteja vazio nesta ficha
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

    if (digits.length === 11) {
      cpfAutoFilledFromSaved = digits;
      fichaState._cpfAutoFilled = digits;
      cpfSuggestionDismissedFor = '';
    }
    persistFichaDraft({ immediate: true });
  }

  function buildPatientSuggestionPreviewHtml(p) {
    if (!p) return '';
    const lines = [];
    if (collapseSpaces(p.vitimaNome)) {
      lines.push(`<div><strong>👤 ${escapeHtml(collapseSpaces(p.vitimaNome))}</strong></div>`);
    }
    const dnTxt = p.vitimaDn ? formatDateBRDisplay(p.vitimaDn) : '';
    const ageTxt = (p.vitimaDn ? calcAgeFromDn(p.vitimaDn) : '') || collapseSpaces(p.vitimaIdade);
    const fmtTel = p.vitimaTelefone ? formatPhoneBR(p.vitimaTelefone, true) : '';
    const telPrefix = fmtTel ? (getPhoneKindBR(fmtTel) === 'celular' ? 'Cel' : 'Tel') : '';
    const docsArr = [
      dnTxt ? `DN: ${dnTxt}` : '',
      ageTxt ? `Idade: ${ageTxt}` : '',
      fmtTel ? `${telPrefix}: ${fmtTel}` : '',
      collapseSpaces(p.vitimaRg) ? `RG: ${collapseSpaces(p.vitimaRg)}` : '',
      collapseSpaces(p.vitimaCns) ? `CNS: ${collapseSpaces(p.vitimaCns)}` : ''
    ].filter(Boolean);
    if (docsArr.length) {
      lines.push(`<div>🪪 ${escapeHtml(docsArr.join(' • '))}</div>`);
    }

    const streetPart = [
      collapseSpaces(p.vitimaEndereco),
      collapseSpaces(p.vitimaNumero) ? `nº ${collapseSpaces(p.vitimaNumero)}` : '',
      collapseSpaces(p.vitimaBairro)
    ].filter(Boolean).join(', ');
    const cityCepPart = [
      collapseSpaces(p.vitimaCidade),
      formatCep(p.vitimaCep) ? `CEP ${formatCep(p.vitimaCep)}` : ''
    ].filter(Boolean).join(' - ');
    if (streetPart || cityCepPart) {
      lines.push(`<div>📍 ${escapeHtml([streetPart, cityCepPart].filter(Boolean).join(' • '))}</div>`);
    }

    const famArr = [
      collapseSpaces(p.vitimaMae) ? `Mãe: ${collapseSpaces(p.vitimaMae)}` : '',
      collapseSpaces(p.vitimaPai) ? `Pai: ${collapseSpaces(p.vitimaPai)}` : '',
      collapseSpaces(p.vitimaNaturalidade) ? `Naturalidade: ${collapseSpaces(p.vitimaNaturalidade)}` : ''
    ].filter(Boolean);
    if (famArr.length) {
      lines.push(`<div>👪 ${escapeHtml(famArr.join(' • '))}</div>`);
    }

    const hasClin = Boolean(
      (Array.isArray(p.antecedentes) && p.antecedentes.length) ||
      (Array.isArray(p.medicamentosSelecionados) && p.medicamentosSelecionados.length) ||
      collapseSpaces(p.medicamentosOutro) ||
      (Array.isArray(p.alergiasSelecionadas) && p.alergiasSelecionadas.length) ||
      collapseSpaces(p.alergiasOutro)
    );
    if (hasClin) {
      lines.push(`<div style="color:#047857; font-weight:700;">🩺 Inclui histórico salvo (antecedentes / medicamentos / alergias)</div>`);
    }
    return lines.join('');
  }

  function renderCpfManageBarHtml(rawCpf) {
    const digits = String(rawCpf || '').replace(/\D+/g, '');
    if (digits.length !== 11 || !window.SamuStorage.isValidCpf(digits)) return '';
    const patMap = window.SamuStorage.getInternalPatientsMap ? window.SamuStorage.getInternalPatientsMap() : {};
    const saved = patMap[digits] || ((pendingCpfSuggestion && pendingCpfSuggestion.cpf11 === digits) ? pendingCpfSuggestion.patient : null);

    if (saved && collapseSpaces(saved.vitimaNome)) {
      const wasAutoFilled = Boolean((fichaState && fichaState._cpfAutoFilled === digits) || (cpfAutoFilledFromSaved === digits));
      const dismissed = (cpfSuggestionDismissedFor === digits);
      const alreadyMatches = fichaAlreadyHasSavedPersonalData(saved, fichaState || {});
      const showSuggestionCard = !wasAutoFilled && !dismissed && !alreadyMatches;

      if (showSuggestionCard) {
        const srcBadge = (pendingCpfSuggestion && pendingCpfSuggestion.cpf11 === digits && pendingCpfSuggestion.sourceLabel)
          ? pendingCpfSuggestion.sourceLabel
          : 'Cadastro Salvo';
        return `
          <div class="cpf-suggest-card">
            <div class="cpf-suggest-header">
              <span>✨ Dados salvos encontrados para este C&#8204;PF!</span>
              <span class="type-badge" style="background:#d1fae5; color:#065f46;">${escapeHtml(srcBadge)}</span>
            </div>
            <div class="cpf-suggest-preview">
              ${buildPatientSuggestionPreviewHtml(saved)}
            </div>
            <div class="cpf-suggest-actions">
              <button type="button" class="btn btn-success btn-sm" id="btn-cpf-accept-suggest" style="flex:1 1 200px; font-weight:800;">
                ✨ Preencher Automaticamente
              </button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-cpf-dismiss-suggest">
                Não usar
              </button>
            </div>
          </div>
        `;
      }

      const addrSummary = [saved.vitimaEndereco, saved.vitimaNumero ? ('nº ' + saved.vitimaNumero) : '', saved.vitimaBairro]
        .filter(Boolean)
        .join(', ');
      return `
        <div class="cpf-manage-bar">
          <div style="flex:1 1 180px; font-size:0.76rem; color:#0c4a6e; font-weight:700;">
            🪪 Cadastro salvo: <strong>${escapeHtml(saved.vitimaNome)}</strong>${addrSummary ? ` • ${escapeHtml(addrSummary)}` : ''}
          </div>
          <button type="button" class="btn btn-success btn-sm" id="btn-cpf-accept-suggest" style="padding:4px 9px; font-size:0.74rem;">✨ Preencher Dados Salvos</button>
        </div>
      `;
    }

    return `
      <div class="cpf-manage-bar" style="background:#f8fafc; border-color:#cbd5e1;">
        <span style="flex:1; font-size:0.75rem; color:#475569; font-weight:700;">🪪 Novo C&#8204;PF — os dados pessoais serão guardados automaticamente ao enviar a ficha</span>
        <button type="button" class="btn btn-outline btn-sm" id="btn-cpf-overwrite-from-ficha" style="padding:4px 9px; font-size:0.74rem; background:#fff;">💾 Salvar Agora</button>
      </div>
    `;
  }

  function computePatientPersonalDiffs(savedPat, fichaData, wasAutoFilled) {
    if (!savedPat || !fichaData) return [];
    const diffs = [];
    const savedDn = normalizePersonalFieldForCompare('vitimaDn', savedPat.vitimaDn);
    const fichaDn = normalizePersonalFieldForCompare('vitimaDn', fichaData.vitimaDn);

    PATIENT_PERSONAL_FIELD_DEFS.forEach(def => {
      const k = def.key;
      const oldVal = normalizePersonalFieldForCompare(k, savedPat[k]);
      const newVal = normalizePersonalFieldForCompare(k, fichaData[k]);
      if (oldVal === newVal) return;

      // Se a equipe não puxou o preenchimento automático e deixou um campo vazio nesta ficha, não trata como exclusão do dado salvo
      if (!wasAutoFilled && !newVal) return;

      // Ignora CEP '14620-000' e Cidade 'Orlândia' pré-preenchidos por padrão na ficha vazia quando nenhum endereço foi digitado
      if (isUntouchedBlankFormDefaultField(k, fichaData, savedPat, wasAutoFilled)) return;

      // Se a Data de Nascimento não mudou e a idade é apenas o cálculo automático da DN, não acusa diferença
      if (k === 'vitimaIdade' && savedDn && fichaDn && savedDn === fichaDn) {
        const autoAge = normalizePersonalFieldForCompare('vitimaIdade', calcAgeFromDn(fichaDn));
        if (newVal === autoAge) return;
      }

      diffs.push({
        key: k,
        label: def.label,
        oldVal,
        newVal,
        oldDisplay: oldVal ? (def.isDate ? formatDateBRDisplay(oldVal) : oldVal) : '(em branco)',
        newDisplay: newVal ? (def.isDate ? formatDateBRDisplay(newVal) : newVal) : '(em branco)'
      });
    });

    return diffs;
  }

  function buildMergedPatientPayloadFromFicha(savedPat, fichaData, cpf11, wasAutoFilled) {
    const payload = { vitimaCpf: cpf11 };
    PATIENT_PERSONAL_FIELD_DEFS.forEach(def => {
      const k = def.key;
      const oldVal = savedPat ? normalizePersonalFieldForCompare(k, savedPat[k]) : '';
      const newVal = normalizePersonalFieldForCompare(k, fichaData[k]);

      if (!savedPat) {
        payload[k] = newVal;
        return;
      }
      if (isUntouchedBlankFormDefaultField(k, fichaData, savedPat, wasAutoFilled)) {
        payload[k] = oldVal || newVal;
        return;
      }
      if (wasAutoFilled) {
        payload[k] = (k === 'vitimaNome' && !newVal) ? oldVal : newVal;
      } else {
        payload[k] = newVal || oldVal;
      }
    });

    if (payload.vitimaDn && !payload.vitimaIdade) {
      payload.vitimaIdade = calcAgeFromDn(payload.vitimaDn) || '';
    }
    if (!payload.vitimaCidade) {
      payload.vitimaCidade = (savedPat && savedPat.vitimaCidade) || 'Orlândia';
    }

    payload.antecedentes = (Array.isArray(fichaData.antecedentes) && fichaData.antecedentes.length)
      ? fichaData.antecedentes.slice()
      : ((savedPat && Array.isArray(savedPat.antecedentes)) ? savedPat.antecedentes.slice() : []);
    payload.medicamentosSelecionados = (Array.isArray(fichaData.medicamentosSelecionados) && fichaData.medicamentosSelecionados.length)
      ? fichaData.medicamentosSelecionados.slice()
      : ((savedPat && Array.isArray(savedPat.medicamentosSelecionados)) ? savedPat.medicamentosSelecionados.slice() : []);
    payload.medicamentosOutro = collapseSpaces(fichaData.medicamentosOutro) || (savedPat && savedPat.medicamentosOutro) || '';
    payload.alergiasSelecionadas = (Array.isArray(fichaData.alergiasSelecionadas) && fichaData.alergiasSelecionadas.length)
      ? fichaData.alergiasSelecionadas.slice()
      : ((savedPat && Array.isArray(savedPat.alergiasSelecionadas)) ? savedPat.alergiasSelecionadas.slice() : []);
    payload.alergiasOutro = collapseSpaces(fichaData.alergiasOutro) || (savedPat && savedPat.alergiasOutro) || '';

    return payload;
  }

  function askUpdateSavedPatientModal(savedPat, fichaData, cpf11, diffs) {
    return new Promise((resolve) => {
      let dlg = document.getElementById('patient-update-confirm-modal');
      if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'patient-update-confirm-modal';
        dlg.className = 'sig-modal hidden';
        dlg.style.zIndex = '185';
        document.body.appendChild(dlg);
      }

      const displayCpf = window.SamuStorage.formatCpf(cpf11);
      const displayName = collapseSpaces(fichaData.vitimaNome) || collapseSpaces(savedPat.vitimaNome) || displayCpf;

      dlg.innerHTML = `
        <div class="card" style="width:100%; max-width:500px; margin:0; padding:18px; max-height:92vh; overflow-y:auto;">
          <div style="display:flex; align-items:flex-start; gap:10px; margin-bottom:8px;">
            <span style="font-size:1.55rem; line-height:1;">🪪</span>
            <div style="text-align:left;">
              <h3 style="margin:0; font-size:1.02rem; color:var(--navy);">Atualizar Dados Salvos do Paciente?</h3>
              <p style="margin:4px 0 0; font-size:0.81rem; color:var(--muted); line-height:1.38;">
                Os dados pessoais preenchidos nesta ficha para <strong>${escapeHtml(displayName)}</strong>
                (CPF <code>${escapeHtml(displayCpf)}</code>) estão diferentes dos dados salvos no aplicativo:
              </p>
            </div>
          </div>

          <div class="patient-diff-list">
            ${diffs.map(df => `
              <div class="patient-diff-item">
                <div class="patient-diff-label">${escapeHtml(df.label)}</div>
                <div class="patient-diff-values">
                  <span class="patient-diff-old" title="Valor salvo atualmente">${escapeHtml(df.oldDisplay)}</span>
                  <span style="font-weight:900; color:#64748b;">➔</span>
                  <span class="patient-diff-new" title="Valor preenchido nesta ficha">${escapeHtml(df.newDisplay)}</span>
                </div>
              </div>
            `).join('')}
          </div>

          <div style="display:flex; flex-direction:column; gap:8px;">
            <button type="button" class="btn btn-success" id="btn-pat-upd-yes" style="width:100%; font-weight:800;">
              ✅ Sim, Atualizar Dados do Paciente e Enviar Ficha
            </button>
            <button type="button" class="btn btn-primary" id="btn-pat-upd-keep" style="width:100%;">
              ➡️ Não Atualizar Cadastro (Apenas Enviar Ficha)
            </button>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-pat-upd-cancel" style="width:100%;">
              ↩️ Voltar p/ Revisar Ficha
            </button>
          </div>
        </div>
      `;

      dlg.classList.remove('hidden');
      const finish = (choice) => {
        dlg.classList.add('hidden');
        resolve(choice);
      };
      document.getElementById('btn-pat-upd-yes').onclick = () => finish('update');
      document.getElementById('btn-pat-upd-keep').onclick = () => finish('keep');
      document.getElementById('btn-pat-upd-cancel').onclick = () => finish('cancel');
    });
  }

  async function handlePatientCadastroOnFichaSend(targetFichaData) {
    if (!targetFichaData) return { proceed: true, action: 'no_data' };
    const cpf11 = String(targetFichaData.vitimaCpf || '').replace(/\D+/g, '');
    const nome = collapseSpaces(targetFichaData.vitimaNome);
    if (cpf11.length !== 11 || !nome) {
      return { proceed: true, action: 'skipped_no_cpf_or_name' };
    }

    const patMap = window.SamuStorage.getInternalPatientsMap ? window.SamuStorage.getInternalPatientsMap() : {};
    let savedPat = patMap[cpf11] || null;
    if (!savedPat && pendingCpfSuggestion && pendingCpfSuggestion.cpf11 === cpf11 && pendingCpfSuggestion.patient) {
      savedPat = pendingCpfSuggestion.patient;
    }

    if (!savedPat && !window.SamuStorage.isValidCpf(cpf11)) {
      return { proceed: true, action: 'skipped_invalid_cpf' };
    }

    const wasAutoFilled = Boolean(
      (targetFichaData._cpfAutoFilled === cpf11) ||
      (cpfAutoFilledFromSaved === cpf11)
    );

    // 1º atendimento deste CPF: guarda automaticamente todos os dados pessoais do paciente para os próximos atendimentos!
    if (!savedPat) {
      try {
        const newPayload = buildMergedPatientPayloadFromFicha(null, targetFichaData, cpf11, true);
        window.SamuStorage.saveEditedPatientInInternalDb(cpf11, newPayload);
      } catch (eSaveNew) {}
      return { proceed: true, action: 'created_new' };
    }

    // Já existe cadastro salvo para este CPF: compara se houve alguma alteração nos dados pessoais
    const diffs = computePatientPersonalDiffs(savedPat, targetFichaData, wasAutoFilled);
    if (diffs.length === 0) {
      return { proceed: true, action: 'unchanged' };
    }

    const choice = await askUpdateSavedPatientModal(savedPat, targetFichaData, cpf11, diffs);
    if (choice === 'cancel') {
      return { proceed: false, action: 'cancel' };
    }
    if (choice === 'update') {
      try {
        const mergedPayload = buildMergedPatientPayloadFromFicha(savedPat, targetFichaData, cpf11, wasAutoFilled);
        window.SamuStorage.saveEditedPatientInInternalDb(cpf11, mergedPayload);
        showToast(`✅ Cadastro pessoal de "${mergedPayload.vitimaNome}" atualizado!`);
      } catch (eUpd) {}
      return { proceed: true, action: 'updated' };
    }
    return { proceed: true, action: 'kept_existing' };
  }

  /* ===================== VISUALIZADOR INTERNO DE PASTAS E PLANILHA DE CONTROLE (SEM PEDIR CONTA GOOGLE) ===================== */
  function ensureDriveExplorerModal() {
    let modal = document.getElementById('drive-explorer-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'drive-explorer-modal';
      modal.className = 'sig-modal hidden';
      modal.style.zIndex = '172';
      modal.innerHTML = '<div class="crew-modal-card" id="drive-explorer-modal-body" style="max-width:920px; width:96%; max-height:92vh; overflow-y:auto;"></div>';
      document.body.appendChild(modal);
    }
    return {
      modal,
      body: document.getElementById('drive-explorer-modal-body')
    };
  }

  async function fetchFreshAdminRecordsForExplorer() {
    if (navigator.onLine && window.SamuStorage.syncAllWithCloud) {
      try {
        await window.SamuStorage.syncAllWithCloud();
      } catch (e) {}
    }
    const all = await window.SamuStorage.getVisibleRecords(currentUser);
    return (all || []).filter(r => r && r.syncStatus !== 'draft');
  }

  async function openInAppDriveFoldersModal() {
    if (!currentUser || !window.SamuStorage.isUserAdmin(currentUser)) return;
    const { modal, body } = ensureDriveExplorerModal();
    if (!modal || !body) return;
    const settings = window.SamuStorage.getSettings();

    modal.classList.remove('hidden');
    body.innerHTML = `<div style="padding:28px; text-align:center; color:var(--muted); font-weight:700;">☁️ Carregando pastas e PDFs sincronizados com o Google Drive...</div>`;

    const records = await fetchFreshAdminRecordsForExplorer();
    let activeFolderType = 'ficha';
    let selectedMonth = 'all';

    const folderDefs = [
      { type: 'ficha', icon: '📋', name: 'Fichas de Atendimento' },
      { type: 'checklist_condutor', icon: '🚑', name: 'Check List - Condutor Socorrista' },
      { type: 'checklist_enfermagem', icon: '🩺', name: 'Check List - Enfermagem' }
    ];

    const getMonthKey = (r) => {
      const raw = String(r.date || r.createdAt || '').trim();
      const m = raw.match(/^(\d{4}-\d{2})/);
      return m ? m[1] : 'Sem-Data';
    };

    const renderExplorer = () => {
      const typeRecords = records.filter(r => r.type === activeFolderType);
      const monthsSet = new Set();
      typeRecords.forEach(r => monthsSet.add(getMonthKey(r)));
      const months = Array.from(monthsSet).sort((a, b) => b.localeCompare(a));
      if (selectedMonth !== 'all' && !monthsSet.has(selectedMonth)) {
        selectedMonth = 'all';
      }
      const visible = selectedMonth === 'all'
        ? typeRecords
        : typeRecords.filter(r => getMonthKey(r) === selectedMonth);

      body.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
          <div>
            <h3 style="margin:0; font-size:1.05rem; color:var(--navy);">📁 Pastas do Google Drive (Acesso Direto ADM no App)</h3>
            <div style="font-size:0.78rem; color:var(--muted); margin-top:2px;">
              Navegue pelas pastas por Tipo e Mês e abra qualquer PDF direto sem precisar logar conta Google no celular
            </div>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            ${settings.rootFolderUrl ? `<a href="${escapeHtml(settings.rootFolderUrl)}" target="_blank" class="btn btn-outline btn-sm" style="text-decoration:none;" title="Requer estar logado no Gmail proprietário ou compartilhado no app Google Drive">↗️ App Google Drive</a>` : ''}
            <button type="button" class="btn btn-secondary btn-sm" id="btn-drv-exp-close">✖ Fechar</button>
          </div>
        </div>

        <div class="catalog-subtabs">
          ${folderDefs.map(fd => {
            const cnt = records.filter(r => r.type === fd.type).length;
            return `<button type="button" class="catalog-subtab ${activeFolderType === fd.type ? 'active' : ''}" data-drv-folder="${fd.type}">${fd.icon} ${escapeHtml(fd.name)} (${cnt})</button>`;
          }).join('')}
        </div>

        <div class="chips-wrap" style="margin-bottom:10px;">
          <button type="button" class="chip-btn ${selectedMonth === 'all' ? 'selected' : ''}" data-drv-month="all">📅 Todos os Meses (${typeRecords.length})</button>
          ${months.map(m => {
            const mCnt = typeRecords.filter(r => getMonthKey(r) === m).length;
            return `<button type="button" class="chip-btn ${selectedMonth === m ? 'selected' : ''}" data-drv-month="${escapeHtml(m)}">📂 ${escapeHtml(m)} (${mCnt})</button>`;
          }).join('')}
        </div>

        <div style="max-height:54vh; overflow-y:auto; border:1px solid #e2e8f0; border-radius:10px; padding:6px 10px;">
          ${visible.length === 0 ? `
            <div style="padding:20px; text-align:center; color:var(--muted); font-size:0.86rem;">Nenhum PDF arquivado nesta pasta ainda.</div>
          ` : visible.map(r => {
            const dt = r.date || String(r.createdAt || '').slice(0, 10);
            const title = r.patientName || r.vehicle || r.summary || (r.type === 'ficha' ? 'Ficha SAMU' : 'Check List');
            return `
              <div class="check-item-row" style="flex-wrap:wrap; gap:8px;">
                <div class="check-item-info">
                  <strong>📄 ${escapeHtml(title)}</strong>
                  <small style="color:var(--muted);"> • ${escapeHtml(dt)} • Pasta: <code>${escapeHtml(getMonthKey(r))}</code></small>
                  <br>
                  <small style="color:var(--muted);">
                    Por: ${escapeHtml(r.createdByName || r.createdBy || '-')}
                    ${r.summary ? ` • ${escapeHtml(r.summary)}` : ''}
                  </small>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                  ${r.data ? `<button type="button" class="btn btn-primary btn-sm" data-drv-preview="${escapeHtml(r.id)}">👁️ Ver PDF no App</button>` : ''}
                  ${(r.driveUrl || r.driveFileId || r.data) ? `<button type="button" class="btn btn-outline btn-sm" style="border-color:#1d4ed8; color:#1d4ed8;" data-drv-print="${escapeHtml(r.id)}">🖨️ Imprimir na Base</button>` : ''}
                  ${r.driveUrl ? `<a href="${escapeHtml(r.driveUrl)}" target="_blank" class="btn btn-success btn-sm" style="text-decoration:none;">☁️ Abrir PDF Drive</a>` : `<span class="type-badge" style="background:#fef3c7;color:#92400e;">Pendente envio</span>`}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      document.getElementById('btn-drv-exp-close').onclick = () => modal.classList.add('hidden');
      body.querySelectorAll('[data-drv-folder]').forEach(btn => {
        btn.onclick = () => {
          activeFolderType = btn.dataset.drvFolder;
          selectedMonth = 'all';
          renderExplorer();
        };
      });
      body.querySelectorAll('[data-drv-month]').forEach(btn => {
        btn.onclick = () => {
          selectedMonth = btn.dataset.drvMonth;
          renderExplorer();
        };
      });
      body.querySelectorAll('[data-drv-preview]').forEach(btn => {
        btn.onclick = async () => {
          const rec = records.find(x => x.id === btn.dataset.drvPreview);
          if (!rec) return;
          modal.classList.add('hidden');
          await openPdfPreviewModal(rec);
        };
      });
      body.querySelectorAll('[data-drv-print]').forEach(btn => {
        btn.onclick = async () => {
          const rec = records.find(x => x.id === btn.dataset.drvPrint);
          if (!rec) return;
          await sendRecordToBasePrinter(rec, null, btn);
        };
      });
    };

    renderExplorer();
  }

  async function openInAppControlSheetModal() {
    if (!currentUser || !window.SamuStorage.isUserAdmin(currentUser)) return;
    const { modal, body } = ensureDriveExplorerModal();
    if (!modal || !body) return;
    const settings = window.SamuStorage.getSettings();

    modal.classList.remove('hidden');
    body.innerHTML = `<div style="padding:28px; text-align:center; color:var(--muted); font-weight:700;">📊 Carregando Planilha de Controle sincronizada...</div>`;

    const records = await fetchFreshAdminRecordsForExplorer();
    let sheetQuery = '';

    const typeLabel = (t) => {
      if (t === 'ficha') return 'Ficha USB';
      if (t === 'checklist_condutor') return 'CK Condutor';
      if (t === 'checklist_enfermagem') return 'CK Enfermagem';
      return t || '-';
    };

    const getFiltered = () => {
      const q = normStr(sheetQuery.trim());
      if (!q) return records;
      return records.filter(r => {
        const blob = `${r.date || ''} ${typeLabel(r.type)} ${r.patientName || ''} ${r.patientCpf || ''} ${r.vehicle || ''} ${r.shift || ''} ${r.risk || ''} ${r.createdByName || ''} ${r.summary || ''}`;
        return normStr(blob).includes(q);
      });
    };

    const buildRowsHtml = (list) => {
      if (!list.length) {
        return `<tr><td colspan="6" style="padding:18px; text-align:center; color:var(--muted);">Nenhum registro encontrado.</td></tr>`;
      }
      return list.map(r => `
        <tr style="border-bottom:1px solid #e2e8f0; font-size:0.79rem;">
          <td style="padding:7px 6px; white-space:nowrap;">${escapeHtml(r.date || String(r.createdAt || '').slice(0, 10))}</td>
          <td style="padding:7px 6px; font-weight:700;">${escapeHtml(typeLabel(r.type))}</td>
          <td style="padding:7px 6px;">${escapeHtml(r.patientName || r.vehicle || r.summary || '-')}${r.patientCpf ? `<br><small style="color:var(--muted);">CPF: ${escapeHtml(r.patientCpf)}</small>` : ''}</td>
          <td style="padding:7px 6px;">${escapeHtml(r.risk || r.shift || '-')}</td>
          <td style="padding:7px 6px;">${escapeHtml(r.createdByName || r.createdBy || '-')}</td>
          <td style="padding:7px 6px; white-space:nowrap;">
            ${r.driveUrl ? `<a href="${escapeHtml(r.driveUrl)}" target="_blank" class="btn btn-success btn-sm" style="padding:3px 8px; font-size:0.73rem; text-decoration:none;">☁️ PDF</a>` : ''}
            ${r.data ? `<button type="button" class="btn btn-outline btn-sm" data-sht-prev="${escapeHtml(r.id)}" style="padding:3px 8px; font-size:0.73rem;">👁️ Ver</button>` : ''}
          </td>
        </tr>
      `).join('');
    };

    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
        <div>
          <h3 style="margin:0; font-size:1.05rem; color:var(--navy);">📊 Planilha de Controle Central (${records.length} registros)</h3>
          <div style="font-size:0.78rem; color:var(--muted); margin-top:2px;">
            Visualização direta dentro do aplicativo (sem pedir login Google) + exportação p/ Excel (.CSV)
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button type="button" class="btn btn-success btn-sm" id="btn-sht-export-csv">📥 Baixar Excel (.CSV)</button>
          ${settings.spreadsheetUrl ? `<a href="${escapeHtml(settings.spreadsheetUrl)}" target="_blank" class="btn btn-outline btn-sm" style="text-decoration:none;" title="Requer estar logado no Gmail proprietário ou compartilhado no app Planilhas">↗️ Google Planilhas</a>` : ''}
          <button type="button" class="btn btn-secondary btn-sm" id="btn-sht-close">✖ Fechar</button>
        </div>
      </div>

      <div class="field" style="margin-bottom:8px;">
        <input type="text" id="inp-sht-search" autocomplete="off" placeholder="🔎 Filtrar na planilha por data, paciente, CPF, viatura ou profissional..." />
      </div>

      <div style="max-height:58vh; overflow:auto; border:1px solid #cbd5e1; border-radius:10px;">
        <table style="width:100%; border-collapse:collapse; text-align:left;">
          <thead style="position:sticky; top:0; background:#0f172a; color:#fff; font-size:0.77rem;">
            <tr>
              <th style="padding:8px 6px;">Data</th>
              <th style="padding:8px 6px;">Tipo</th>
              <th style="padding:8px 6px;">Paciente / Viatura</th>
              <th style="padding:8px 6px;">Risco / Turno</th>
              <th style="padding:8px 6px;">Profissional</th>
              <th style="padding:8px 6px;">PDF</th>
            </tr>
          </thead>
          <tbody id="sht-tbody">
            ${buildRowsHtml(records)}
          </tbody>
        </table>
      </div>
    `;

    const bindPreviewBtns = () => {
      body.querySelectorAll('[data-sht-prev]').forEach(btn => {
        btn.onclick = async () => {
          const rec = records.find(x => x.id === btn.dataset.shtPrev);
          if (!rec) return;
          modal.classList.add('hidden');
          await openPdfPreviewModal(rec);
        };
      });
    };
    bindPreviewBtns();

    document.getElementById('btn-sht-close').onclick = () => modal.classList.add('hidden');
    document.getElementById('inp-sht-search').addEventListener('input', (e) => {
      sheetQuery = e.target.value || '';
      const tb = document.getElementById('sht-tbody');
      if (tb) {
        tb.innerHTML = buildRowsHtml(getFiltered());
        bindPreviewBtns();
      }
    });

    document.getElementById('btn-sht-export-csv').onclick = () => {
      const list = getFiltered();
      const csvEsc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const header = ['Data', 'Tipo', 'Paciente', 'CPF', 'Risco', 'Viatura', 'Turno', 'Profissional', 'Resumo', 'Link_PDF_Drive'].join(';');
      const lines = list.map(r => [
        r.date || String(r.createdAt || '').slice(0, 10),
        typeLabel(r.type),
        r.patientName || '',
        r.patientCpf || '',
        r.risk || '',
        r.vehicle || '',
        r.shift || '',
        r.createdByName || r.createdBy || '',
        r.summary || '',
        r.driveUrl || ''
      ].map(csvEsc).join(';'));
      const csvContent = '\uFEFF' + [header].concat(lines).join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Planilha_Controle_SAMU_Orlandia_${todayISO()}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 500);
      showToast('📥 Planilha .CSV gerada (abre direto no Excel)!');
    };
  }

  function updateTopbarUserHeader() {
    if (!currentUser) return;
    const nameEl = document.getElementById('top-user-name');
    const roleEl = document.getElementById('top-user-role');
    if (nameEl) nameEl.textContent = currentUser.name;
    const choice = window.SamuStorage.getUserProfileChoice(currentUser);
    const shortRoleMap = {
      admin: 'ADM / COORDENAÇÃO',
      condutor: 'CONDUTOR SOCORRISTA',
      condutor_admin: 'CONDUTOR + ADM',
      enfermeiro: 'ENFERMEIRO(A)',
      enfermeiro_admin: 'ENFERMEIRO(A) + ADM',
      tecnico: 'TÉC. ENFERM.',
      tecnico_admin: 'TÉC. ENFERM. + ADM'
    };
    const userCoren = currentUser.coren || currentUser.councilId || '';
    const roleBadgeText = (currentUser.role === 'enfermagem' && userCoren)
      ? `${shortRoleMap[choice] || 'ENFERMAGEM'} • ${userCoren}`
      : (shortRoleMap[choice] || currentUser.role);
    if (roleEl) roleEl.textContent = roleBadgeText;
    updateTopbarCrewButton();
  }

  async function enterSession(user, options) {
    const opts = options || {};
    // Recarrega dados mais frescos do usuário na base interna (ex: COREN, subRole e isAdmin atualizados)
    const freshLocal = window.SamuStorage.getLocalUsers().find(u => u.username.toLowerCase() === String(user.username || '').toLowerCase());
    if (freshLocal && freshLocal.active) {
      user = Object.assign({}, user, {
        name: freshLocal.name || user.name,
        password: freshLocal.password || user.password,
        role: freshLocal.role || user.role,
        subRole: window.SamuStorage.getUserSubRole(freshLocal),
        isAdmin: window.SamuStorage.isUserAdmin(freshLocal),
        coren: freshLocal.coren || freshLocal.councilId || user.coren || user.councilId || '',
        councilId: freshLocal.coren || freshLocal.councilId || user.councilId || '',
        cpf: freshLocal.cpf || user.cpf || ''
      });
      window.SamuStorage.setSession(user);
    }

    currentUser = user;
    const isOperational = window.SamuStorage.hasOperationalRole(user);
    activeCrew = isOperational ? window.SamuStorage.getActiveCrewForUser(user.username) : null;
    manualShowSecondEnf = false;
    manualShowSecondCond = false;

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');

    updateTopbarUserHeader();
    const userCoren = user.coren || user.councilId || '';

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

    // Se já faz parte de uma equipe ativa no plantão, sincroniza imediatamente a ficha compartilhada e as assinaturas da equipe!
    if (activeCrew) {
      await window.SamuStorage.syncAllCrewDraftsToLocalRecords();
      const ws = window.SamuStorage.getCrewWorkspace(activeCrew.crewId);
      if (ws && ws.currentFicha && ws.currentFicha.data) {
        const localDoc = hasMeaningfulFichaData(fichaState)
          ? {
              sessionId: ws.currentFicha.sessionId,
              recordId: editingFichaId || '',
              isLoadedRecord: Boolean(editingFichaId),
              updatedAt: (draftFicha && draftFicha.updatedAt) || new Date(0).toISOString(),
              updatedBy: user.username,
              updatedByName: user.name,
              fieldTs: {},
              data: fichaState
            }
          : null;
        const merged = window.SamuStorage.mergeSharedFichaDocs(localDoc, ws.currentFicha, ws.closedSessions);
        if (merged && merged.data) {
          fichaState = normalizeFichaData(merged.data);
          editingFichaId = merged.recordId || null;
          applyCrewToFichaState(fichaState, activeCrew, false);
          resetFichaSyncTracking(fichaState, merged.sessionId, merged.fieldTs, merged.isLoadedRecord);
        } else {
          applyCrewToFichaState(fichaState, activeCrew, true);
          resetFichaSyncTracking(fichaState, uid('sf'), {}, Boolean(editingFichaId));
        }
      } else {
        applyCrewToFichaState(fichaState, activeCrew, true);
        resetFichaSyncTracking(fichaState, uid('sf'), {}, Boolean(editingFichaId));
      }
    } else {
      resetFichaSyncTracking(fichaState, uid('sf'), {}, Boolean(editingFichaId));
      if (user.role === 'enfermagem') {
        if (!fichaState.enfermagemNome) fichaState.enfermagemNome = user.name;
        if (!fichaState.enfermagemCoren && userCoren) fichaState.enfermagemCoren = userCoren;
      } else if (user.role === 'condutor') {
        if (!fichaState.condutorNome) fichaState.condutorNome = user.name;
      }
    }
    if (!fichaState.destino) {
      fichaState.destino = window.SamuStorage.getSettings().defaultHospital || 'HBSA';
    }

    const draftCond = await window.SamuStorage.getDraft(user.username, 'checklist_condutor');
    condutorState = (draftCond && draftCond.data) ? Object.assign(createEmptyCondutor(), draftCond.data) : createEmptyCondutor();
    applySavedAvariasToCondutorState(condutorState, false);
    applySharedDailyToCondutorState(condutorState, { replaceOtherShift: false });
    editingCondutorId = null;
    condutorValidationActive = false;

    const draftEnf = await window.SamuStorage.getDraft(user.username, 'checklist_enfermagem');
    enfermagemState = (draftEnf && draftEnf.data) ? Object.assign(createEmptyEnfermagem(), draftEnf.data) : createEmptyEnfermagem();
    if (user.role === 'enfermagem') {
      if (!enfermagemState.responsavelNome) enfermagemState.responsavelNome = user.name;
      if (!enfermagemState.responsavelCoren && userCoren) enfermagemState.responsavelCoren = userCoren;
    }
    syncActiveShiftFieldsInEnfermagem(enfermagemState);
    applySharedDailyToEnfermagemState(enfermagemState, { replaceOtherShift: false });
    editingEnfermagemId = null;
    enfermagemValidationActive = false;

    await refreshDraftCount();
    const pendingCount = window.SamuStorage.getPendingUsers().length;
    if (window.SamuStorage.isUserAdmin(user) && !isOperational) {
      activeTab = pendingCount > 0 ? 'aprovacoes' : 'historico';
    } else {
      activeTab = 'ficha';
      if (window.SamuStorage.isUserAdmin(user) && pendingCount > 0) {
        showToast(`🔔 Há ${pendingCount} cadastro(s) aguardando aprovação na aba "✅ Aprovar"!`);
      }
    }
    renderBottomNav();
    renderActiveView();
    upgradeExistingSignaturesToBlueInk();
    await refreshSyncBadge();
    triggerBackgroundSync(false);

    // Toda vez que o Téc. de Enfermagem, Enfermeiro(a) ou Condutor (inclusive híbrido c/ ADM) logar, pergunta com quem está trabalhando no plantão!
    if (opts.promptCrew && isOperational) {
      openCrewSelectionModal({ isLoginPrompt: true });
    }
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
      txt.textContent = settings.scriptUrl ? '☁️ Drive Sync OK' : '☁️ Sync OK';
    }
  }

  async function triggerBackgroundSync(interactive) {
    if (!currentUser) return;
    const settings = window.SamuStorage.getSettings();
    const hasGh = window.SamuStorage.hasGitHubConfigured();

    if (!navigator.onLine) {
      if (interactive) showToast('📴 Sem internet agora: funcionando 100% pela Base Interna Offline! Sincronizará com o Google Drive assim que conectar.');
      return;
    }

    if (!settings.scriptUrl && !hasGh) {
      if (interactive) {
        if (window.SamuStorage.isUserAdmin(currentUser)) {
          activeTab = 'admin';
          renderBottomNav();
          renderActiveView();
          showToast('Configure a conexão com o Google Drive abaixo.');
        } else {
          samuAlert('Funcionando na Base Interna Offline deste aparelho.');
        }
      }
      return;
    }

    try {
      if (interactive) showToast('☁️ Sincronizando dados e PDFs com Google Drive...');
      const res = await window.SamuStorage.syncAllWithCloud();
      upgradeExistingSignaturesToBlueInk();
      renderBottomNav();
      await refreshSyncBadge();
      if (activeTab === 'historico') renderHistoricoView();
      if (activeTab === 'aprovacoes') renderAprovacoesView(true);
      if (interactive) {
        if (res.uploadedCount > 0) {
          showToast(`✅ Base sincronizada e ${res.uploadedCount} PDF(s) enviado(s) ao Google Drive!`);
        } else {
          showToast('✅ Base sincronizada com o Google Drive com sucesso!');
        }
      }
    } catch (err) {
      if (interactive) samuAlert('Erro na sincronização: ' + err.message);
    }
  }

  function getChecklistModulesCfg() {
    return window.SamuStorage.getChecklistModulesConfig
      ? window.SamuStorage.getChecklistModulesConfig()
      : { condutorEnabled: true, enfermagemEnabled: true };
  }

  function isChecklistAllowed(kind, user) {
    const u = user || currentUser;
    if (!u) return true;
    if (window.SamuStorage.isChecklistAllowedForUser) {
      return window.SamuStorage.isChecklistAllowedForUser(kind, u);
    }
    return true;
  }

  function isRecordAllowedForCurrentUser(rec) {
    if (!rec) return false;
    if (rec.type === 'checklist_condutor') return isChecklistAllowed('condutor', currentUser);
    if (rec.type === 'checklist_enfermagem') return isChecklistAllowed('enfermagem', currentUser);
    return true;
  }

  function getNavTabsForUser(user) {
    if (window.SamuStorage.isUserAdmin(user)) {
      const pendingUsersCount = window.SamuStorage.getPendingUsers().length;
      if (window.SamuStorage.hasOperationalRole(user)) {
        const isCond = user.role === 'condutor';
        return [
          { id: 'ficha', icon: '📋', label: 'Ficha' },
          isCond
            ? { id: 'condutor', icon: '🚑', label: 'CK Cond.' }
            : { id: 'enfermagem', icon: '🩺', label: 'CK Enf.' },
          isCond
            ? { id: 'enfermagem', icon: '🩺', label: 'CK Enf.' }
            : { id: 'condutor', icon: '🚑', label: 'CK Cond.' },
          { id: 'historico', icon: '🔎', label: 'Histórico' },
          { id: 'aprovacoes', icon: '✅', label: 'Aprovar', badge: pendingUsersCount },
          { id: 'admin', icon: '⚙️', label: 'Base/Drive' }
        ];
      }
      return [
        { id: 'historico', icon: '🔎', label: 'Histórico' },
        { id: 'aprovacoes', icon: '✅', label: 'Aprovar', badge: pendingUsersCount },
        { id: 'ficha', icon: '📋', label: 'Ficha' },
        { id: 'condutor', icon: '🚑', label: 'CK Cond.' },
        { id: 'enfermagem', icon: '🩺', label: 'CK Enf.' },
        { id: 'admin', icon: '⚙️', label: 'Base/Drive' }
      ];
    }
    if (user && user.role === 'condutor') {
      const tabs = [{ id: 'ficha', icon: '📋', label: 'Ficha USB' }];
      if (isChecklistAllowed('condutor', user)) {
        tabs.push({ id: 'condutor', icon: '🚑', label: 'Check List' });
      }
      tabs.push({ id: 'historico', icon: '🔎', label: 'Meu Histórico' });
      return tabs;
    }
    const tabs = [{ id: 'ficha', icon: '📋', label: 'Ficha USB' }];
    if (isChecklistAllowed('enfermagem', user)) {
      tabs.push({ id: 'enfermagem', icon: '🩺', label: 'Check List' });
    }
    tabs.push({ id: 'historico', icon: '🔎', label: 'Meu Histórico' });
    return tabs;
  }

  function renderBottomNav(opts) {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;
    const tabs = getNavTabsForUser(currentUser);
    let redirectedFromDisabledTab = false;
    if (tabs.length > 0 && !tabs.some(t => t.id === activeTab)) {
      activeTab = tabs[0].id;
      redirectedFromDisabledTab = true;
    }
    nav.innerHTML = tabs.map(t => `
      <button type="button" class="nav-tab ${activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">
        ${t.badge > 0 ? `<span class="nav-badge">${t.badge}</span>` : ''}
        <span class="nav-icon">${t.icon}</span>
        <span>${t.label}</span>
      </button>
    `).join('');

    nav.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (crewDirtySinceLastPush) flushCrewCloudPushNow();
        activeTab = btn.dataset.tab;
        if (activeTab === 'condutor' && !editingCondutorId && condutorState) {
          applySharedDailyToCondutorState(condutorState, { replaceOtherShift: false });
          if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
            window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: false }).then(() => {
              if (activeTab === 'condutor' && !editingCondutorId && condutorState) {
                applySharedDailyToCondutorState(condutorState, { replaceOtherShift: false });
                const ae = document.activeElement;
                if (!ae || (ae.tagName !== 'INPUT' && ae.tagName !== 'TEXTAREA')) renderCondutorView();
              }
            }).catch(() => {});
          }
        } else if (activeTab === 'enfermagem' && !editingEnfermagemId && enfermagemState) {
          applySharedDailyToEnfermagemState(enfermagemState, { replaceOtherShift: false });
          if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
            window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: false }).then(() => {
              if (activeTab === 'enfermagem' && !editingEnfermagemId && enfermagemState) {
                applySharedDailyToEnfermagemState(enfermagemState, { replaceOtherShift: false });
                const ae = document.activeElement;
                if (!ae || (ae.tagName !== 'INPUT' && ae.tagName !== 'TEXTAREA')) renderEnfermagemView();
              }
            }).catch(() => {});
          }
        }
        renderBottomNav();
        renderActiveView();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    if (redirectedFromDisabledTab && !(opts && opts.skipRedirectRender)) {
      renderActiveView();
      showToast('ℹ️ Check List desativado pela Coordenação/ADM.');
    }
  }

  function renderActiveView() {
    if (activeTab === 'ficha') return renderFichaView();
    if (activeTab === 'condutor') return renderCondutorView();
    if (activeTab === 'enfermagem') return renderEnfermagemView();
    if (activeTab === 'historico') return renderHistoricoView();
    if (activeTab === 'aprovacoes') return renderAprovacoesView();
    if (activeTab === 'admin') return renderAdminView();
  }

  function persistFichaDraft(opts) {
    if (!currentUser || !fichaState) return;
    if (editingFichaId) {
      window.SamuStorage.saveDraft(currentUser.username, 'ficha', { __editingId: editingFichaId, state: fichaState });
    } else {
      window.SamuStorage.saveDraft(currentUser.username, 'ficha', fichaState);
    }

    stampChangedFichaFields(Date.now());
    if (window.SamuStorage.hasOperationalRole(currentUser)) {
      activeCrew = window.SamuStorage.getActiveCrewForUser(currentUser.username);
      if (activeCrew) {
        if (!currentCrewSessionId) {
          currentCrewSessionId = editingFichaId ? ('sf_rec_' + editingFichaId) : uid('sf');
        }
        window.SamuStorage.saveCrewCurrentFicha(activeCrew.crewId, {
          sessionId: currentCrewSessionId,
          recordId: editingFichaId || '',
          isLoadedRecord: currentCrewIsLoadedRecord,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.username,
          updatedByName: currentUser.name,
          fieldTs: currentFichaFieldTs,
          data: fichaState
        }, false);
        scheduleCrewCloudPush(opts);
      }
    }
  }

  async function refreshDraftCount() {
    if (!currentUser) {
      cachedDraftCount = 0;
      return 0;
    }
    const vis = await window.SamuStorage.getVisibleRecords(currentUser);
    cachedDraftCount = vis.filter(r => r.syncStatus === 'draft' && isRecordAllowedForCurrentUser(r)).length;
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
        if (activeCrew) {
          window.SamuStorage.closeCrewCurrentSession(activeCrew.crewId, currentCrewSessionId, 'reset', '', '', false);
        }
        fichaState = createEmptyFicha();
        fichaStep = 1;
        resetFichaSyncTracking(fichaState, uid('sf'), {}, false);
        await window.SamuStorage.clearDraft(currentUser.username, 'ficha');
        renderFichaView();
        showToast('Nova ficha em branco pronta!');
        return;
      }

      const prevKmFinal = fichaState.kmFinal ? String(fichaState.kmFinal).trim() : '';
      if (prevKmFinal !== '') {
        window.SamuStorage.setLastKmFinal(prevKmFinal);
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
        if (activeCrew) {
          window.SamuStorage.closeCrewCurrentSession(activeCrew.crewId, currentCrewSessionId, 'draft_saved', recId, prevKmFinal, false);
          scheduleCrewCloudPush();
        }
        editingFichaId = null;
        manualShowSecondEnf = false;
        manualShowSecondCond = false;
        fichaState = createEmptyFicha();
        fichaStep = 1;
        resetFichaSyncTracking(fichaState, uid('sf'), {}, false);
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
    const drafts = vis.filter(r => r.syncStatus === 'draft' && isRecordAllowedForCurrentUser(r));
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
        if (!rec || !isRecordAllowedForCurrentUser(rec)) return;

        // Se o usuário estava digitando outra ficha nova ainda não salva na lista, salva automaticamente antes de trocar!
        if (rec.type === 'ficha' && !editingFichaId && hasMeaningfulFichaData(fichaState)) {
          await saveCurrentAsDraftRecord('ficha', false);
        }

        if (rec.type === 'ficha') {
          fichaState = normalizeFichaData(rec.data);
          if (activeCrew) {
            applyCrewToFichaState(fichaState, activeCrew, false);
          }
          editingFichaId = rec.id;
          fichaStep = 1;
          resetFichaSyncTracking(fichaState, 'sf_rec_' + rec.id, {}, true);
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

  let autofillNeutralSeq = 0;
  function disableExternalAutofillInContainer(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('form').forEach(fm => {
      fm.setAttribute('autocomplete', 'off');
    });
    root.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea').forEach(el => {
      if (el.dataset.samuNoAutofill === '1') return;
      el.dataset.samuNoAutofill = '1';
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('data-form-type', 'other');
      el.setAttribute('data-lpignore', 'true');
      el.setAttribute('data-1p-ignore', 'true');
      el.setAttribute('data-bwignore', 'true');
      if (!el.getAttribute('name')) {
        autofillNeutralSeq = (autofillNeutralSeq + 1) % 999999;
        el.setAttribute('name', 's_op_' + autofillNeutralSeq);
      }
      const im = el.getAttribute('inputmode') || '';
      if (im === 'numeric' || im === 'decimal' || el.type === 'number') {
        el.setAttribute('spellcheck', 'false');
        el.setAttribute('autocapitalize', 'off');
      }
    });
  }

  function bindQuickDraftBarEvents(container) {
    disableExternalAutofillInContainer(container);
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

  /* ===================== ROLAGEM HORIZONTAL DAS ETAPAS (1. OCORRÊNCIA ... 6. ASSINATURAS) ===================== */
  function renderStepPillsBarHtml(barId, pillsInnerHtml) {
    return `
      <div class="step-pills-bar" data-step-bar="${escapeHtml(barId)}">
        <button type="button" class="step-scroll-btn" data-step-scroll="-1" aria-label="Rolar etapas para a esquerda" title="Ver etapas anteriores">‹</button>
        <div class="step-pills" data-pills-id="${escapeHtml(barId)}">
          ${pillsInnerHtml}
        </div>
        <button type="button" class="step-scroll-btn" data-step-scroll="1" aria-label="Rolar etapas para a direita" title="Ver próximas etapas">›</button>
      </div>
    `;
  }

  function bindStepPillsHorizontalScroll(container) {
    container.querySelectorAll('.step-pills-bar').forEach(bar => {
      if (bar.dataset.scrollBound === '1') return;
      bar.dataset.scrollBound = '1';
      const pills = bar.querySelector('.step-pills');
      const btnLeft = bar.querySelector('[data-step-scroll="-1"]');
      const btnRight = bar.querySelector('[data-step-scroll="1"]');
      if (!pills) return;

      const syncArrows = () => {
        const maxScroll = Math.max(0, pills.scrollWidth - pills.clientWidth);
        const hasOverflow = maxScroll > 4;
        if (btnLeft) {
          btnLeft.classList.toggle('hidden-arrow', !hasOverflow);
          btnLeft.disabled = pills.scrollLeft <= 2;
        }
        if (btnRight) {
          btnRight.classList.toggle('hidden-arrow', !hasOverflow);
          btnRight.disabled = pills.scrollLeft >= maxScroll - 2;
        }
      };

      const centerActivePill = () => {
        const activeBtn = pills.querySelector('.step-pill.active');
        if (activeBtn && pills.scrollWidth > pills.clientWidth) {
          const targetLeft = activeBtn.offsetLeft - (pills.clientWidth / 2) + (activeBtn.offsetWidth / 2);
          pills.scrollLeft = Math.max(0, targetLeft);
        }
        syncArrows();
      };

      // Centraliza a etapa ativa logo na montagem e após layout
      centerActivePill();
      requestAnimationFrame(centerActivePill);

      pills.addEventListener('scroll', syncArrows, { passive: true });
      if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(() => syncArrows());
        ro.observe(pills);
      }

      if (btnLeft) {
        btnLeft.addEventListener('click', () => {
          pills.scrollBy({ left: -180, behavior: 'smooth' });
        });
      }
      if (btnRight) {
        btnRight.addEventListener('click', () => {
          pills.scrollBy({ left: 180, behavior: 'smooth' });
        });
      }

      // Rolagem com roda do mouse no PC / Simulador
      pills.addEventListener('wheel', (e) => {
        if (pills.scrollWidth <= pills.clientWidth) return;
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          pills.scrollLeft += e.deltaY;
        }
      }, { passive: false });

      // Arrastar com mouse no PC / Simulador (toque nativo já funciona via touch-action: pan-x)
      let isMouseDown = false;
      let startX = 0;
      let startScrollLeft = 0;
      let draggedDistance = 0;

      pills.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        isMouseDown = true;
        draggedDistance = 0;
        startX = e.pageX;
        startScrollLeft = pills.scrollLeft;
        pills.classList.add('dragging');
      });

      const stopDrag = () => {
        if (!isMouseDown) return;
        isMouseDown = false;
        pills.classList.remove('dragging');
      };

      pills.addEventListener('mousemove', (e) => {
        if (!isMouseDown) return;
        const dx = e.pageX - startX;
        draggedDistance = Math.max(draggedDistance, Math.abs(dx));
        if (draggedDistance > 4) {
          e.preventDefault();
          pills.scrollLeft = startScrollLeft - dx;
        }
      });

      pills.addEventListener('mouseup', stopDrag);
      pills.addEventListener('mouseleave', stopDrag);

      // Evita clique acidental em etapa ao arrastar a barra com o mouse
      pills.addEventListener('click', (e) => {
        if (draggedDistance > 7) {
          e.preventDefault();
          e.stopPropagation();
          draggedDistance = 0;
        }
      }, true);
    });
  }

  /* ===================== CAIXA DE SELEÇÃO COMPACTA (MEDICAMENTOS E ALERGIAS) ===================== */
  function buildSelectBoxSummary(selectedArr, placeholder, pluralWord) {
    const list = Array.isArray(selectedArr) ? selectedArr.filter(Boolean) : [];
    if (list.length === 0) {
      return {
        text: placeholder,
        cls: 'is-placeholder',
        chevronClosed: 'Selecionar ▼'
      };
    }
    if (list.length === 1 && list[0] === 'Nega') {
      return {
        text: '✅ Nega',
        cls: 'is-nega',
        chevronClosed: 'Alterar ▼'
      };
    }
    if (list.length === 1) {
      return {
        text: `✅ ${list[0]}`,
        cls: 'is-has-items',
        chevronClosed: 'Alterar ▼'
      };
    }
    return {
      text: `✅ ${list.length} ${pluralWord}: ${list.join(', ')}`,
      cls: 'is-has-items',
      chevronClosed: `Alterar (${list.length}) ▼`
    };
  }

  function buildSelectBoxTagsHtml(boxKey, selectedArr) {
    const list = (Array.isArray(selectedArr) ? selectedArr : []).filter(x => x && x !== 'Nega');
    if (list.length === 0) return '';
    return list.map(item => `
      <span class="select-box-tag">
        <span>${escapeHtml(item)}</span>
        <button type="button" data-sbox-remove="${escapeHtml(boxKey)}" data-sbox-val="${escapeHtml(item)}" title="Remover">×</button>
      </span>
    `).join('');
  }

  function renderSelectBoxHtml(cfg) {
    const isOpen = openSelectBoxKey === cfg.boxKey;
    const selected = Array.isArray(cfg.selected) ? cfg.selected : [];
    const summary = buildSelectBoxSummary(selected, cfg.placeholder, cfg.pluralWord);
    const q = String(cfg.filterQuery || '').trim();
    const qNorm = normStr(q);

    const optionsHtml = (cfg.options || []).map(op => {
      const matches = !qNorm || normStr(op).includes(qNorm);
      const isSel = selected.includes(op);
      const isNega = op === 'Nega';
      return `
        <button type="button"
          class="select-box-option ${isNega ? 'is-nega-opt' : ''} ${isSel ? 'is-selected' : ''} ${matches ? '' : 'hidden'}"
          data-sbox-opt="${escapeHtml(cfg.boxKey)}"
          data-sbox-val="${escapeHtml(op)}">
          <span class="select-box-check">✓</span>
          <span>${escapeHtml(op)}</span>
        </button>
      `;
    }).join('');

    return `
      <div class="select-box-wrap ${isOpen ? 'is-open' : ''}" id="select-box-${escapeHtml(cfg.boxKey)}" data-sbox-key="${escapeHtml(cfg.boxKey)}">
        <button type="button" class="select-box-trigger" data-sbox-toggle="${escapeHtml(cfg.boxKey)}">
          <span class="select-box-summary ${summary.cls}">${escapeHtml(summary.text)}</span>
          <span class="select-box-chevron">${isOpen ? 'Fechar ▲' : summary.chevronClosed}</span>
        </button>
        <div class="select-box-tags" data-sbox-tags="${escapeHtml(cfg.boxKey)}">${buildSelectBoxTagsHtml(cfg.boxKey, selected)}</div>
        <div class="select-box-panel ${isOpen ? '' : 'hidden'}" data-sbox-panel="${escapeHtml(cfg.boxKey)}">
          <div class="select-box-panel-top">
            <input type="search" class="select-box-search" data-sbox-search="${escapeHtml(cfg.boxKey)}"
              placeholder="${escapeHtml(cfg.searchPlaceholder)}" value="${escapeHtml(cfg.filterQuery || '')}" />
            <button type="button" class="select-box-done-btn" data-sbox-done="${escapeHtml(cfg.boxKey)}">Concluir ▲</button>
          </div>
          <div class="select-box-list" data-sbox-list="${escapeHtml(cfg.boxKey)}">
            ${optionsHtml}
          </div>
        </div>
      </div>
    `;
  }

  function updateSelectBoxInPlace(boxKey) {
    const wrap = document.getElementById(`select-box-${boxKey}`);
    if (!wrap) return;
    const isMed = boxKey === 'med';
    const selected = isMed ? (fichaState.medicamentosSelecionados || []) : (fichaState.alergiasSelecionadas || []);
    const placeholder = isMed ? 'Toque para selecionar medicamentos na lista...' : 'Toque para selecionar alergias na lista...';
    const pluralWord = isMed ? 'selecionados' : 'selecionadas';
    const isOpen = openSelectBoxKey === boxKey;

    wrap.classList.toggle('is-open', isOpen);
    const panel = wrap.querySelector(`[data-sbox-panel="${boxKey}"]`);
    if (panel) panel.classList.toggle('hidden', !isOpen);

    const summary = buildSelectBoxSummary(selected, placeholder, pluralWord);
    const sumEl = wrap.querySelector('.select-box-summary');
    if (sumEl) {
      sumEl.className = `select-box-summary ${summary.cls}`;
      sumEl.textContent = summary.text;
    }
    const chevEl = wrap.querySelector('.select-box-chevron');
    if (chevEl) {
      chevEl.textContent = isOpen ? 'Fechar ▲' : summary.chevronClosed;
    }
    const tagsEl = wrap.querySelector(`[data-sbox-tags="${boxKey}"]`);
    if (tagsEl) {
      tagsEl.innerHTML = buildSelectBoxTagsHtml(boxKey, selected);
    }
    wrap.querySelectorAll(`[data-sbox-opt="${boxKey}"]`).forEach(optBtn => {
      const v = optBtn.dataset.sboxVal;
      optBtn.classList.toggle('is-selected', selected.includes(v));
    });
  }

  let outsideSelectBoxBound = false;
  function ensureOutsideSelectBoxCloseListener() {
    if (outsideSelectBoxBound) return;
    outsideSelectBoxBound = true;
    document.addEventListener('click', (e) => {
      if (!openSelectBoxKey) return;
      if (e.target && e.target.closest && e.target.closest('.select-box-wrap')) return;
      const prevKey = openSelectBoxKey;
      openSelectBoxKey = '';
      updateSelectBoxInPlace(prevKey);
    });
  }

  /* ==========================================================================
   * ABA 1: FICHA DE ATENDIMENTO USB INTERATIVA (5 ETAPAS RÁPIDAS)
   * ========================================================================== */
  function renderFichaView() {
    const container = document.getElementById('main-view');
    const d = fichaState;
    if (fichaStep > 5) fichaStep = 5;
    if (fichaStep < 1) fichaStep = 1;
    const steps = [
      { n: 1, label: '1. Ocorrência' },
      { n: 2, label: '2. Vítima' },
      { n: 3, label: '3. Avaliação' },
      { n: 4, label: '4. Conduta/Relatório' },
      { n: 5, label: '5. Assinaturas' }
    ];

    let stepHtml = '';

    if (fichaStep === 1) {
      const lastKmSaved = window.SamuStorage.getLastKmFinal();
      stepHtml = `
        <div class="card">
          <div class="card-title">
            <span>📍 Dados da Solicitação e Ocorrência</span>
          </div>
          <div class="grid-date-kms">
            <div class="field field-full-phone">
              <label>Data</label>
              <input type="date" data-f="data" value="${escapeHtml(d.data)}" />
            </div>
            <div class="field">
              <label style="display:flex; justify-content:space-between; align-items:center; gap:4px; flex-wrap:wrap;">
                <span>KM Inicial</span>
                ${lastKmSaved ? `<button type="button" id="btn-use-last-km" style="background:none;border:none;padding:0;color:var(--success);font-size:0.72rem;font-weight:800;cursor:pointer;" title="Toque para usar o último KM Final salvo">↺ Último: ${escapeHtml(lastKmSaved)}</button>` : ''}
              </label>
              <input type="number" inputmode="numeric" id="inp-km-inicial" placeholder="Ex: 84520" data-f="kmInicial" value="${escapeHtml(d.kmInicial)}" />
            </div>
            <div class="field">
              <label>KM Final <small style="color:var(--muted);font-weight:600;">(próx. inicial)</small></label>
              <input type="number" inputmode="numeric" id="inp-km-final" placeholder="Ex: 84532" data-f="kmFinal" value="${escapeHtml(d.kmFinal)}" />
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:baseline; gap:6px; flex-wrap:wrap; margin:4px 0 6px;">
            <div class="section-subtitle" style="margin:0;">⏱️ Horários da Ocorrência</div>
            <small style="color:var(--muted); font-size:0.74rem; font-weight:600;">Toque em <strong>AGORA</strong> para cravar ou digite</small>
          </div>
          <div class="time-grid" style="margin-bottom:14px;">
            ${window.SAMU_SCHEMA.horariosFicha.map(h => `
              <div class="time-card">
                <label>${h.label}</label>
                <div class="time-input-row">
                  <input type="time" autocomplete="off" data-horario="${h.key}" value="${escapeHtml((d.horarios && d.horarios[h.key]) || '')}" />
                  <button type="button" class="btn-now" data-now="${h.key}">⏱ AGORA</button>
                </div>
              </div>
            `).join('')}
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

          <div class="grid-cep-addr">
            <div class="field field-full-phone">
              <label>C&#8204;EP do Local (Wi-Fi/4G)</label>
              <div class="input-action-row">
                <input type="text" inputmode="numeric" id="f-occ-cod" autocomplete="off" placeholder="00000&#8204;-000" data-f="ocorrenciaCep" value="${escapeHtml(d.ocorrenciaCep || '')}" />
                <button type="button" class="btn-lookup" id="btn-lookup-occ-cep">🔍 C&#8204;EP</button>
              </div>
              <div id="occ-cep-hint" class="field-hint"></div>
            </div>
            <div class="field">
              <label>Endere&#8204;ço da Ocorrência</label>
              <input type="text" id="f-occ-loc1" autocomplete="off" placeholder="R&#8204;ua / Aveni&#8204;da / Rodov&#8204;ia" data-f="ocorrenciaEndereco" value="${escapeHtml(d.ocorrenciaEndereco)}" />
            </div>
            <div class="field">
              <label>Núme&#8204;ro / KM</label>
              <input type="text" id="f-occ-loc2" autocomplete="off" placeholder="N&#8204;º ou KM" data-f="ocorrenciaNumero" value="${escapeHtml(d.ocorrenciaNumero)}" />
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label>Ponto de Referência / Bair&#8204;ro</label>
              <input type="text" id="f-occ-obs1" autocomplete="off" placeholder="Próximo a..." data-f="ocorrenciaReferencia" value="${escapeHtml(d.ocorrenciaReferencia)}" />
            </div>
            <div class="field">
              <label>Conta&#8204;to / Tele&#8204;fone</label>
              <input type="text" inputmode="numeric" id="f-occ-cnt1" autocomplete="off" placeholder="Ex: (16) 0 0000&#8204; 0000 / (16) 0000&#8204; 0000" data-f="ocorrenciaContato" value="${escapeHtml(d.ocorrenciaContato)}" />
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
            <button type="button" class="btn btn-outline btn-sm" id="btn-copy-occ-addr">📍 Usar Endere&#8204;ço da Ocorrência</button>
          </div>

          <div class="grid-cpf-docs">
            <div class="field field-full-phone">
              <label>C&#8204;PF (sugere dados salvos / Wi-Fi)</label>
              <div class="input-action-row">
                <input type="text" inputmode="numeric" id="f-vit-doc1" autocomplete="off" placeholder="000.000&#8204;.000-00" data-f="vitimaCpf" value="${escapeHtml(d.vitimaCpf)}" />
                <button type="button" class="btn-lookup" id="btn-lookup-cpf" title="Buscar dados do paciente pelo CPF">🔍 C&#8204;PF</button>
              </div>
              <div id="cpf-lookup-hint" class="field-hint">${cpfHintInit}</div>
              <div id="cpf-manage-slot">${renderCpfManageBarHtml(d.vitimaCpf)}</div>
            </div>
            <div class="field">
              <label>R&#8204;G</label>
              <input type="text" id="f-vit-doc2" autocomplete="off" placeholder="R&#8204;G" data-f="vitimaRg" value="${escapeHtml(d.vitimaRg)}" />
            </div>
            <div class="field">
              <label>Cartão SUS (CNS)</label>
              <input type="text" id="f-vit-doc3" inputmode="numeric" autocomplete="off" placeholder="Opcional" data-f="vitimaCns" value="${escapeHtml(d.vitimaCns)}" />
            </div>
          </div>

          <div class="field">
            <label>No&#8204;me Completo da Vítima (usado na busca do histórico)</label>
            <input type="text" id="f-vit-ident" autocomplete="off" placeholder="Digite o no&#8204;me do paciente" data-f="vitimaNome" value="${escapeHtml(d.vitimaNome)}" />
          </div>
          <div class="grid-dn-age-cnt">
            <div class="field">
              <label>Data de Nascimento (DN)</label>
              <input type="date" id="f-vit-nasc" autocomplete="off" data-f="vitimaDn" value="${escapeHtml(d.vitimaDn)}" />
            </div>
            <div class="field">
              <label>Idade</label>
              <input type="text" id="f-vit-anos" autocomplete="off" placeholder="Ex: 54 anos" data-f="vitimaIdade" value="${escapeHtml(d.vitimaIdade)}" />
            </div>
            <div class="field field-full-phone">
              <label style="display:flex; align-items:center; flex-wrap:wrap;">Celu&#8204;lar / Tele&#8204;fone <span id="vit-cnt-kind-lbl">${buildVictimPhoneKindBadgeHtml(d.vitimaTelefone)}</span></label>
              <input type="text" inputmode="numeric" id="f-vit-cnt1" autocomplete="off" placeholder="Ex: (16) 0 0000&#8204; 0000 ou (16) 0000&#8204; 0000" data-f="vitimaTelefone" value="${escapeHtml(d.vitimaTelefone || '')}" />
            </div>
          </div>

          <div class="grid-cep-city">
            <div class="field field-full-phone">
              <label>C&#8204;EP Residencial (puxa r&#8204;ua no Wi-Fi)</label>
              <div class="input-action-row">
                <input type="text" inputmode="numeric" id="f-vit-cod" autocomplete="off" placeholder="00000&#8204;-000" data-f="vitimaCep" value="${escapeHtml(d.vitimaCep)}" onfocus="this.select()" />
                <button type="button" class="btn-lookup" id="btn-lookup-vit-cep" title="Buscar endereço pelo CEP online">🔍 C&#8204;EP</button>
              </div>
              <div id="cep-lookup-hint" class="field-hint"></div>
            </div>
            <div class="field">
              <label>Cida&#8204;de</label>
              <input type="text" id="f-vit-mun" autocomplete="off" data-f="vitimaCidade" value="${escapeHtml(d.vitimaCidade)}" />
            </div>
            <div class="field">
              <label>Bair&#8204;ro</label>
              <input type="text" id="f-vit-area" autocomplete="off" placeholder="Bair&#8204;ro" data-f="vitimaBairro" value="${escapeHtml(d.vitimaBairro)}" />
            </div>
          </div>

          <div class="grid-addr-num">
            <div class="field">
              <label>Endere&#8204;ço Residencial</label>
              <input type="text" id="f-vit-loc1" autocomplete="off" placeholder="R&#8204;ua / Av." data-f="vitimaEndereco" value="${escapeHtml(d.vitimaEndereco)}" />
            </div>
            <div class="field">
              <label>Núme&#8204;ro</label>
              <input type="text" id="f-vit-loc2" autocomplete="off" placeholder="N&#8204;º" data-f="vitimaNumero" value="${escapeHtml(d.vitimaNumero)}" />
            </div>
          </div>

          <div class="grid-3">
            <div class="field">
              <label>Naturalidade</label>
              <input type="text" id="f-vit-orig" autocomplete="off" placeholder="Cida&#8204;de/UF" data-f="vitimaNaturalidade" value="${escapeHtml(d.vitimaNaturalidade)}" />
            </div>
            <div class="field">
              <label>No&#8204;me do Pai</label>
              <input type="text" id="f-vit-fil1" autocomplete="off" data-f="vitimaPai" value="${escapeHtml(d.vitimaPai)}" />
            </div>
            <div class="field">
              <label>No&#8204;me da Mãe</label>
              <input type="text" id="f-vit-fil2" autocomplete="off" data-f="vitimaMae" value="${escapeHtml(d.vitimaMae)}" />
            </div>
          </div>

          <div class="regulacao-callout">
            <div style="font-size:0.84rem; color:#14532d; font-weight:700;">
              📲 <strong>Envio para a Regulação Médica:</strong> gera uma foto nítida apenas da parte frontal do PDF preenchido — do início da ficha até a barra de Horários (Ocorrência, Vítima e Horários).
            </div>
            <button type="button" class="btn btn-whatsapp js-btn-send-regulacao">
              📲 Enviar Cabeçalho p/ Regulação no WhatsApp
            </button>
          </div>
        </div>
      `;
    } else if (fichaStep === 3) {
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
            <div class="grid-burns-footer">
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
              <button type="button" class="btn btn-secondary btn-sm field-full-phone" id="btn-clear-burns" style="height:42px;">Limpar Boneco</button>
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
          <div class="grid-vitals">
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
          ${renderSelectBoxHtml({
            boxKey: 'med',
            options: window.SAMU_SCHEMA.medicamentosOpcoes || [],
            selected: d.medicamentosSelecionados || [],
            placeholder: 'Toque para selecionar medicamentos na lista...',
            searchPlaceholder: '🔎 Buscar medicamento na lista (ex: Losartana, Rivotril)...',
            filterQuery: medFilterQuery,
            pluralWord: 'selecionados'
          })}
          <div class="field">
            <label>Outro(s) Medicamento(s) fora da lista (separe por vírgula)</label>
            <input type="text" id="inp-med-outro" placeholder="Digite aqui se o paciente usar outro medicamento..." data-f="medicamentosOutro" value="${escapeHtml(d.medicamentosOutro || '')}" />
          </div>

          <div class="section-subtitle">Alergias</div>
          ${renderSelectBoxHtml({
            boxKey: 'alergia',
            options: window.SAMU_SCHEMA.alergiasOpcoes || [],
            selected: d.alergiasSelecionadas || [],
            placeholder: 'Toque para selecionar alergias na lista...',
            searchPlaceholder: '🔎 Buscar alergia na lista (ex: Dipirona, Amoxicilina)...',
            filterQuery: alergiaFilterQuery,
            pluralWord: 'selecionadas'
          })}
          <div class="field" style="margin-bottom:0;">
            <label>Outra(s) Alergia(s) fora da lista (escrever)</label>
            <input type="text" id="inp-alergia-outro" placeholder="Escreva aqui se houver outra alergia..." data-f="alergiasOutro" value="${escapeHtml(d.alergiasOutro || '')}" />
          </div>
        </div>
      `;
    } else if (fichaStep === 4) {
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
            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
              <label style="margin:0;">Médico Regulador</label>
              <small style="color:var(--muted); font-size:0.72rem; font-weight:700;">Salva automático p/ próximas fichas</small>
            </div>
            ${(() => {
              const savedMedicos = window.SamuStorage.getMedicosReguladores ? window.SamuStorage.getMedicosReguladores() : [];
              const curValLower = String(d.medicoRegulador || '').trim().toLowerCase();
              return `
                <div class="receiver-saved-box" style="margin-top:4px; margin-bottom:6px;">
                  <div style="font-size:0.76rem; font-weight:800; color:#334155;">
                    ⚡ Médicos Reguladores salvos (${savedMedicos.length}) — toque no nome p/ preencher:
                  </div>
                  ${savedMedicos.length > 0 ? `
                    <div class="receiver-chip-wrap">
                      ${savedMedicos.map(m => {
                        const mLow = String(m.nome || '').trim().toLowerCase();
                        const isSel = Boolean(mLow && (curValLower === mLow || curValLower.startsWith(mLow + ' ') || curValLower.startsWith(mLow + '/') || curValLower.startsWith(mLow + '-')));
                        return `
                          <span class="receiver-chip ${isSel ? 'active' : ''}" data-pick-medico="${escapeHtml(m.id)}" title="Toque para preencher este Médico Regulador">
                            <span>👨‍⚕️ ${escapeHtml(m.nome)}</span>
                          </span>
                        `;
                      }).join('')}
                    </div>
                  ` : `
                    <div style="font-size:0.75rem; color:var(--muted); margin-top:4px;">
                      Nenhum médico regulador salvo ainda. Ao preencher abaixo nas fichas, o nome já vai ficando salvo automaticamente para selecionar com 1 toque!
                    </div>
                  `}
                </div>
              `;
            })()}
            <div class="input-action-row">
              <input type="text" id="inp-medico-regulador" placeholder="Dr(a). Nome / CRM (ou Senha de regulação)" data-f="medicoRegulador" value="${escapeHtml(d.medicoRegulador)}" />
              <button type="button" class="btn-lookup" id="btn-save-medico-now" title="Salvar este Médico Regulador na lista rápida agora">💾 Salvar</button>
            </div>
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
    } else if (fichaStep === 5) {
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
              <label>No&#8204;me Completo do Assinante</label>
              <input type="text" id="f-trm-ident" autocomplete="off" data-f="termoNome" value="${escapeHtml(d.termoNome)}" />
            </div>
            <div class="field">
              <label>C&#8204;PF do Assinante</label>
              <input type="text" id="f-trm-doc1" inputmode="numeric" autocomplete="off" data-f="termoCpf" value="${escapeHtml(d.termoCpf)}" />
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
              <div class="section-subtitle" style="margin-top:0;">Setor Recomendado (SAMU) <small style="font-weight:700; text-transform:none; color:var(--muted);">— apenas 1</small></div>
              <div class="chips-wrap">
                ${window.SAMU_SCHEMA.setoresHospital.map(s => `
                  <button type="button" class="chip-btn ${(d.setorRecomendado || []).includes(s) ? 'selected' : ''}" data-arr="setorRecomendado" data-val="${escapeHtml(s)}">${s}</button>
                `).join('')}
              </div>
            </div>
            <div>
              <div class="section-subtitle" style="margin-top:0;">Setor Admitido (Hospital) <small style="font-weight:700; text-transform:none; color:var(--muted);">— apenas 1</small></div>
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
                <label>No&#8204;me do Profissional</label>
                <input type="text" id="f-rec-prof" autocomplete="off" placeholder="Quem recebeu o paciente no hospital" data-f="recebidoPorNome" value="${escapeHtml(d.recebidoPorNome)}" />
              </div>
              <div class="field">
                <label>COREN / CRM</label>
                <div class="input-action-row">
                  <input type="text" id="f-rec-reg" autocomplete="off" placeholder="COREN ou CRM" data-f="recebidoCorenCrm" value="${escapeHtml(d.recebidoCorenCrm)}" />
                  <button type="button" class="btn-lookup" id="btn-save-receiver-now" title="Salvar este Nome e COREN/CRM na lista rápida agora">💾 Salvar</button>
                </div>
              </div>
              <div class="sig-preview-box ${d.sigRecebido ? 'signed' : ''}" data-sig-target="sigRecebido" data-sig-title="Assinatura – Recebido Por (Hospital)">
                ${d.sigRecebido ? `<img src="${d.sigRecebido}" alt="Assinatura Hospital" />` : `<span>✍️ Assinar (Hospital)</span>`}
              </div>
            </div>

            <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
              ${(() => {
                const hasSecondEnf = Boolean(
                  manualShowSecondEnf ||
                  (activeCrew && activeCrew.nursingSlots && activeCrew.nursingSlots.length > 1) ||
                  d.enfermagem2Nome || d.enfermagem2Coren || d.sigEnfermagem2
                );
                const enf1Owner = d.enfermagemSlot1User || (currentUser && currentUser.role === 'enfermagem' ? currentUser.username : '');
                const enf2Owner = d.enfermagemSlot2User || '';
                return `
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
                    <strong style="font-size:0.86rem; color:var(--samu-red-dark);">ENFERMAGEM (SAMU)</strong>
                    <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
                      ${activeCrew
                        ? `<small style="color:#15803d; font-size:0.72rem; font-weight:800;">✅ Preenchido pela Equipe</small>`
                        : ((currentUser && currentUser.role === 'enfermagem' && d.enfermagemCoren)
                            ? `<small style="color:#15803d; font-size:0.73rem; font-weight:800;">✅ COREN do login</small>`
                            : ((currentUser && currentUser.role === 'enfermagem' && (currentUser.coren || currentUser.councilId))
                                ? `<button type="button" class="btn btn-outline btn-sm" id="btn-fill-my-coren" style="padding:2px 8px; font-size:0.72rem;">🔄 Usar meu COREN</button>`
                                : ''))}
                      ${!hasSecondEnf ? `<button type="button" class="btn btn-outline btn-sm" id="btn-add-second-enf" style="padding:2px 8px; font-size:0.71rem;">+ 2º Enfermagem</button>` : ''}
                    </div>
                  </div>
                  <div class="field" style="margin-top:8px;">
                    <label>${hasSecondEnf ? '1º Profissional Enfermagem (Enfermeiro / Téc.)' : 'Nome Enfermagem SAMU'}</label>
                    <input type="text" data-f="enfermagemNome" value="${escapeHtml(d.enfermagemNome)}" />
                  </div>
                  <div class="field">
                    <label>COREN</label>
                    <input type="text" data-f="enfermagemCoren" placeholder="Ex: COREN-SP 000000" value="${escapeHtml(d.enfermagemCoren)}" />
                  </div>
                  <div class="sig-preview-box ${d.sigEnfermagem ? 'signed' : ''}" data-sig-target="sigEnfermagem" data-sig-personal="1" data-sig-user="${escapeHtml(enf1Owner)}" data-sig-title="Assinatura – ${escapeHtml(d.enfermagemNome || 'Enfermagem (SAMU)')}">
                    ${d.sigEnfermagem ? `<img src="${d.sigEnfermagem}" alt="Assinatura Enfermagem" />` : `<span>✍️ Assinar (${escapeHtml(d.enfermagemNome || 'Enfermagem')})</span>`}
                  </div>

                  ${hasSecondEnf ? `
                    <div class="sub-slot-divider">
                      <span>👩‍⚕️ 2º Profissional Enfermagem (Equipe em 3)</span>
                    </div>
                    <div class="field">
                      <label>2º Nome Enfermagem SAMU</label>
                      <input type="text" data-f="enfermagem2Nome" placeholder="Nome do 2º profissional de Enfermagem" value="${escapeHtml(d.enfermagem2Nome || '')}" />
                    </div>
                    <div class="field">
                      <label>2º COREN</label>
                      <input type="text" data-f="enfermagem2Coren" placeholder="Ex: COREN-SP 000000" value="${escapeHtml(d.enfermagem2Coren || '')}" />
                    </div>
                    <div class="sig-preview-box ${d.sigEnfermagem2 ? 'signed' : ''}" data-sig-target="sigEnfermagem2" data-sig-personal="1" data-sig-user="${escapeHtml(enf2Owner)}" data-sig-title="Assinatura – ${escapeHtml(d.enfermagem2Nome || '2º Enfermagem (SAMU)')}">
                      ${d.sigEnfermagem2 ? `<img src="${d.sigEnfermagem2}" alt="Assinatura 2º Enfermagem" />` : `<span>✍️ Assinar (${escapeHtml(d.enfermagem2Nome || '2º Enfermagem')})</span>`}
                    </div>
                  ` : ''}
                `;
              })()}
            </div>
          </div>

          <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px; margin-top:12px;">
            ${(() => {
              const hasSecondCond = Boolean(
                manualShowSecondCond ||
                (activeCrew && activeCrew.driverSlots && activeCrew.driverSlots.length > 1) ||
                d.condutor2Nome || d.sigCondutor2
              );
              const cond1Owner = d.condutorSlot1User || (currentUser && currentUser.role === 'condutor' ? currentUser.username : '');
              const cond2Owner = d.condutorSlot2User || '';
              return `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
                  <strong style="font-size:0.86rem; color:var(--samu-red-dark);">CONDUTOR SOCORRISTA (SAMU)</strong>
                  <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
                    ${activeCrew ? `<button type="button" class="btn btn-outline btn-sm" id="btn-reapply-crew-sigs" style="padding:2px 8px; font-size:0.71rem;">🔄 Reaplicar Equipe</button>` : ''}
                    ${!hasSecondCond ? `<button type="button" class="btn btn-outline btn-sm" id="btn-add-second-cond" style="padding:2px 8px; font-size:0.71rem;">+ 2º Condutor</button>` : ''}
                  </div>
                </div>
                <div class="field" style="margin-top:8px;">
                  <label>${hasSecondCond ? '1º Condutor Socorrista' : 'Nome do Condutor Socorrista'}</label>
                  <input type="text" data-f="condutorNome" value="${escapeHtml(d.condutorNome)}" />
                </div>
                <div class="sig-preview-box ${d.sigCondutor ? 'signed' : ''}" data-sig-target="sigCondutor" data-sig-personal="1" data-sig-user="${escapeHtml(cond1Owner)}" data-sig-title="Assinatura – ${escapeHtml(d.condutorNome || 'Condutor Socorrista (SAMU)')}">
                  ${d.sigCondutor ? `<img src="${d.sigCondutor}" alt="Assinatura Condutor" />` : `<span>✍️ Assinar (${escapeHtml(d.condutorNome || 'Condutor Socorrista')})</span>`}
                </div>

                ${hasSecondCond ? `
                  <div class="sub-slot-divider">
                    <span>🚑 2º Condutor Socorrista (Equipe em 3)</span>
                  </div>
                  <div class="field">
                    <label>2º Condutor Socorrista</label>
                    <input type="text" data-f="condutor2Nome" placeholder="Nome do 2º Condutor Socorrista" value="${escapeHtml(d.condutor2Nome || '')}" />
                  </div>
                  <div class="sig-preview-box ${d.sigCondutor2 ? 'signed' : ''}" data-sig-target="sigCondutor2" data-sig-personal="1" data-sig-user="${escapeHtml(cond2Owner)}" data-sig-title="Assinatura – ${escapeHtml(d.condutor2Nome || '2º Condutor Socorrista (SAMU)')}">
                    ${d.sigCondutor2 ? `<img src="${d.sigCondutor2}" alt="Assinatura 2º Condutor" />` : `<span>✍️ Assinar (${escapeHtml(d.condutor2Nome || '2º Condutor Socorrista')})</span>`}
                  </div>
                ` : ''}
              `;
            })()}
          </div>
        </div>
      `;
    }

    const crewBarHtml = (() => {
      if (!currentUser || !window.SamuStorage.hasOperationalRole(currentUser)) return '';
      activeCrew = window.SamuStorage.getActiveCrewForUser(currentUser.username);
      updateTopbarCrewButton();
      if (activeCrew && activeCrew.membersDetailed && activeCrew.membersDetailed.length >= 2) {
        const ws = window.SamuStorage.getCrewWorkspace(activeCrew.crewId);
        const cf = ws && ws.currentFicha;
        let syncInfo = '✅ Ficha sincronizada e assinaturas da equipe preenchidas';
        if (cf && cf.updatedByName && cf.updatedAt) {
          const dt = new Date(cf.updatedAt);
          const hhmm = !isNaN(dt.getTime())
            ? (String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0'))
            : '';
          syncInfo = `🔄 Sincronizada • Última edição: ${cf.updatedByName}${hhmm ? ` às ${hhmm}` : ''}`;
        }
        const membersChips = activeCrew.membersDetailed.map(m => {
          const ic = m.subRole === 'condutor' ? '🚑' : (m.subRole === 'enfermeiro' ? '👩‍⚕️' : '🩺');
          return `${ic} ${m.name}`;
        }).join('  •  ');
        return `
          <div class="crew-sync-bar">
            <div style="flex:1; min-width:210px;">
              <div style="font-size:0.81rem; font-weight:800; color:#14532d;">
                👥 Equipe do Plantão (${activeCrew.membersDetailed.length}): ${escapeHtml(membersChips)}
              </div>
              <div style="font-size:0.74rem; color:#166534; margin-top:2px;">
                ${escapeHtml(syncInfo)}
              </div>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="btn btn-outline btn-sm" id="btn-crew-sync-now" style="background:#fff; padding:5px 9px; font-size:0.75rem;">🔄 Sincronizar</button>
              <button type="button" class="btn btn-secondary btn-sm js-open-crew-modal" style="padding:5px 9px; font-size:0.75rem;">👥 Equipe</button>
            </div>
          </div>
        `;
      }
      return `
        <div class="crew-sync-bar unpaired">
          <div style="flex:1; min-width:210px;">
            <div style="font-size:0.81rem; font-weight:800; color:#9a3412;">
              👥 Informe com quem você está trabalhando hoje (2 ou até 3 integrantes)
            </div>
            <div style="font-size:0.74rem; color:#7c2d12; margin-top:2px;">
              Sincroniza a ficha em preenchimento entre vocês e já preenche os nomes, COREN e assinaturas no final!
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm js-open-crew-modal" style="padding:6px 11px; font-size:0.77rem;">
            👥 Definir Equipe
          </button>
        </div>
      `;
    })();

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

      ${crewBarHtml}

      ${renderQuickDraftBarHtml('ficha')}

      ${renderStepPillsBarHtml('ficha-steps', steps.map(s => `
        <button type="button" class="step-pill ${fichaStep === s.n ? 'active' : ''}" data-step="${s.n}">${s.label}</button>
      `).join(''))}

      ${stepHtml}

      <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:10px;">
        <button type="button" class="btn btn-outline" id="btn-prev-step" ${fichaStep === 1 ? 'disabled style="opacity:0.4"' : ''}>⬅️ Etapa Anterior</button>
        <button type="button" class="btn btn-outline" id="btn-next-step" ${fichaStep === 5 ? 'disabled style="opacity:0.4"' : ''}>Próxima Etapa ➡️</button>
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
    bindStepPillsHorizontalScroll(container);
    ensureOutsideSelectBoxCloseListener();

    container.querySelectorAll('.step-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        if (crewDirtySinceLastPush) flushCrewCloudPushNow();
        openSelectBoxKey = '';
        fichaStep = Number(btn.dataset.step);
        renderFichaView();
      });
    });

    const prevBtn = document.getElementById('btn-prev-step');
    const nextBtn = document.getElementById('btn-next-step');
    if (prevBtn) prevBtn.addEventListener('click', () => { if (fichaStep > 1) { if (crewDirtySinceLastPush) flushCrewCloudPushNow(); openSelectBoxKey = ''; fichaStep--; renderFichaView(); window.scrollTo(0, 0); } });
    if (nextBtn) nextBtn.addEventListener('click', () => { if (fichaStep < 5) { if (crewDirtySinceLastPush) flushCrewCloudPushNow(); openSelectBoxKey = ''; fichaStep++; renderFichaView(); window.scrollTo(0, 0); } });

    container.querySelectorAll('.js-open-crew-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        openCrewSelectionModal({ isLoginPrompt: false });
      });
    });

    const btnCrewSyncNow = document.getElementById('btn-crew-sync-now');
    if (btnCrewSyncNow) {
      btnCrewSyncNow.addEventListener('click', async () => {
        btnCrewSyncNow.disabled = true;
        btnCrewSyncNow.textContent = '⏳...';
        try {
          if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
            await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: window.SamuStorage.getGitHubMeta().dirty });
          }
          await pullAndApplyCrewFichaChanges({ fromNetwork: true });
          await refreshDraftCount();
          await refreshSyncBadge();
          renderFichaView();
          showToast(navigator.onLine
            ? '🔄 Ficha da equipe sincronizada com sucesso!'
            : '🔄 Sincronizada na memória interna (sem internet agora).');
        } catch (err) {
          samuAlert('Erro ao sincronizar ficha da equipe: ' + err.message);
        } finally {
          btnCrewSyncNow.disabled = false;
          btnCrewSyncNow.textContent = '🔄 Sincronizar';
        }
      });
    }

    document.getElementById('btn-reset-ficha').addEventListener('click', async () => {
      if (!(await samuConfirm(editingFichaId ? 'Sair desta ficha e abrir uma nova ficha em branco (com o último KM Final)?' : 'Limpar todos os campos desta ficha em andamento?'))) return;
      const prevKmFinal = fichaState.kmFinal ? String(fichaState.kmFinal).trim() : '';
      if (prevKmFinal !== '') {
        window.SamuStorage.setLastKmFinal(prevKmFinal);
      }
      if (activeCrew) {
        window.SamuStorage.closeCrewCurrentSession(activeCrew.crewId, currentCrewSessionId, 'reset', editingFichaId || '', prevKmFinal, false);
        scheduleCrewCloudPush();
      }
      editingFichaId = null;
      manualShowSecondEnf = false;
      manualShowSecondCond = false;
      fichaState = createEmptyFicha();
      fichaStep = 1;
      resetFichaSyncTracking(fichaState, uid('sf'), {}, false);
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
      const inp = document.getElementById(isOcc ? 'f-occ-cod' : 'f-vit-cod');
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
            const endEl = document.getElementById('f-occ-loc1');
            if (endEl) endEl.value = res.endereco;
          }
          if (res.bairro && !fichaState.ocorrenciaReferencia) {
            fichaState.ocorrenciaReferencia = 'Bairro ' + res.bairro;
            const refEl = document.getElementById('f-occ-obs1');
            if (refEl) refEl.value = fichaState.ocorrenciaReferencia;
          }
          persistFichaDraft({ immediate: true });
          if (hint) {
            hint.innerHTML = res.endereco
              ? `<span class="hint-ok">✅ ${escapeHtml(res.endereco)} (${escapeHtml(res.cidade)}-${escapeHtml(res.uf)})</span>`
              : `<span class="hint-ok">✅ CEP geral de ${escapeHtml(res.cidade)}-${escapeHtml(res.uf)} confirmado! Digite a rua.</span>`;
          }
          const numEl = document.getElementById('f-occ-loc2');
          if (res.endereco && numEl) numEl.focus();
        } else {
          fichaState.vitimaCep = res.cep;
          inp.value = res.cep;
          if (res.cidade) {
            fichaState.vitimaCidade = res.cidade;
            const cidEl = document.getElementById('f-vit-mun');
            if (cidEl) cidEl.value = res.cidade;
          }
          if (res.bairro) {
            fichaState.vitimaBairro = res.bairro;
            const baiEl = document.getElementById('f-vit-area');
            if (baiEl) baiEl.value = res.bairro;
          }
          if (res.endereco) {
            fichaState.vitimaEndereco = res.endereco;
            const endEl = document.getElementById('f-vit-loc1');
            if (endEl) endEl.value = res.endereco;
          }
          persistFichaDraft({ immediate: true });
          if (hint) {
            hint.innerHTML = res.endereco
              ? `<span class="hint-ok">✅ Endereço puxado: ${escapeHtml(res.endereco)}</span>`
              : `<span class="hint-ok">✅ CEP único de ${escapeHtml(res.cidade)}-${escapeHtml(res.uf)}. Informe o bairro e rua.</span>`;
          }
          const numEl = document.getElementById('f-vit-loc2');
          if (res.endereco && numEl) numEl.focus();
        }
      } catch (err) {
        if (hint) hint.innerHTML = `<span class="hint-warn">⚠️ ${escapeHtml(err.message || 'Não foi possível puxar o CEP.')}</span>`;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔍 CEP'; }
      }
    };

    const executeCpfLookup = async (manualClick) => {
      const inp = document.getElementById('f-vit-doc1');
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
      if (hint) hint.innerHTML = '<span style="color:var(--muted);">🔎 Verificando dados salvos para este CPF...</span>';
      try {
        const res = await window.SamuStorage.lookupPatientByCpf(digits);
        if (res && res.patient) {
          const p = res.patient;
          const srcLabel = res.source === 'samu_cloud'
            ? 'Base SAMU Drive'
            : (res.source === 'external_api' ? 'Consulta Online' : 'Cadastro Salvo');
          pendingCpfSuggestion = { cpf11: digits, sourceLabel: srcLabel, patient: p };
          if (manualClick) {
            cpfSuggestionDismissedFor = '';
            cpfAutoFilledFromSaved = '';
            if (fichaState) fichaState._cpfAutoFilled = '';
          }
          const alreadyMatches = !manualClick && fichaAlreadyHasSavedPersonalData(p, fichaState);
          if (alreadyMatches) {
            if (hint) hint.innerHTML = `<span class="hint-ok">✅ Dados deste CPF já estão preenchidos (${escapeHtml(srcLabel)}).</span>`;
          } else {
            if (hint) hint.innerHTML = `<span class="hint-ok">✨ Cadastro encontrado (${escapeHtml(srcLabel)}) — toque em <strong>Preencher Automaticamente</strong> abaixo!</span>`;
            showToast(`🪪 Paciente encontrado: ${p.vitimaNome || 'Cadastro salvo'} — toque para preencher!`);
          }
        } else {
          pendingCpfSuggestion = null;
          if (hint) {
            hint.innerHTML = navigator.onLine
              ? '<span class="hint-ok">✅ CPF válido (1º atendimento — os dados pessoais serão salvos automaticamente ao enviar a ficha).</span>'
              : '<span class="hint-ok">✅ CPF válido (offline — os dados preenchidos ficarão salvos para os próximos atendimentos).</span>';
          }
          if (manualClick) showToast('CPF válido, ainda sem atendimento anterior salvo na base.');
        }
      } catch (err) {
        if (hint) hint.innerHTML = `<span class="hint-warn">⚠️ ${escapeHtml(err.message || 'Erro ao consultar CPF.')}</span>`;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔍 CPF'; }
        refreshCpfManageSlot();
      }
    };

    const bindCpfManageSlotEvents = () => {
      const slot = document.getElementById('cpf-manage-slot');
      if (!slot) return;

      const acceptBtn = document.getElementById('btn-cpf-accept-suggest');
      if (acceptBtn) {
        acceptBtn.addEventListener('click', () => {
          const digits = String(fichaState.vitimaCpf || '').replace(/\D+/g, '');
          const patMap = window.SamuStorage.getInternalPatientsMap ? window.SamuStorage.getInternalPatientsMap() : {};
          const targetPat = patMap[digits] || ((pendingCpfSuggestion && pendingCpfSuggestion.cpf11 === digits) ? pendingCpfSuggestion.patient : null);
          if (!targetPat) return;
          applyPatientSuggestionToFicha(targetPat, digits);
          const hint = document.getElementById('cpf-lookup-hint');
          if (hint) {
            hint.innerHTML = '<span class="hint-ok">✅ Dados pessoais preenchidos automaticamente! Se alterar algo, ao enviar a ficha o app perguntará se deseja atualizar o cadastro.</span>';
          }
          refreshCpfManageSlot();
          showToast(`✨ Dados de "${targetPat.vitimaNome || 'paciente'}" preenchidos automaticamente!`);
        });
      }

      const dismissBtn = document.getElementById('btn-cpf-dismiss-suggest');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
          const digits = String(fichaState.vitimaCpf || '').replace(/\D+/g, '');
          cpfSuggestionDismissedFor = digits;
          const hint = document.getElementById('cpf-lookup-hint');
          if (hint) {
            hint.innerHTML = '<span style="color:var(--muted);">Preenchimento manual selecionado. Ao enviar a ficha, o app perguntará se deseja atualizar os dados salvos.</span>';
          }
          refreshCpfManageSlot();
        });
      }

      const overwriteBtn = document.getElementById('btn-cpf-overwrite-from-ficha');
      if (overwriteBtn) {
        overwriteBtn.addEventListener('click', () => {
          const digits = String(fichaState.vitimaCpf || '').replace(/\D+/g, '');
          if (digits.length !== 11 || !window.SamuStorage.isValidCpf(digits)) {
            samuAlert('Informe um CPF válido com 11 números.');
            return;
          }
          if (!String(fichaState.vitimaNome || '').trim()) {
            samuAlert('Preencha o Nome Completo da Vítima antes de salvar o cadastro deste CPF.');
            const nmEl = document.getElementById('f-vit-ident');
            if (nmEl) nmEl.focus();
            return;
          }
          try {
            const payload = buildMergedPatientPayloadFromFicha(null, fichaState, digits, true);
            const saved = window.SamuStorage.saveEditedPatientInInternalDb(digits, payload);
            cpfAutoFilledFromSaved = digits;
            fichaState._cpfAutoFilled = digits;
            persistFichaDraft();
            refreshCpfManageSlot();
            showToast(`✅ Dados pessoais de "${saved.vitimaNome}" salvos no CPF e sincronizados!`);
          } catch (err) {
            samuAlert(err.message || 'Erro ao salvar pré-cadastro do CPF.');
          }
        });
      }
    };

    const refreshCpfManageSlot = () => {
      const slot = document.getElementById('cpf-manage-slot');
      if (!slot) return;
      slot.innerHTML = renderCpfManageBarHtml(fichaState.vitimaCpf);
      bindCpfManageSlotEvents();
    };
    bindCpfManageSlotEvents();

    const btnOccCep = document.getElementById('btn-lookup-occ-cep');
    if (btnOccCep) btnOccCep.addEventListener('click', () => executeCepLookup('occ', true));

    const btnVitCep = document.getElementById('btn-lookup-vit-cep');
    if (btnVitCep) btnVitCep.addEventListener('click', () => executeCepLookup('vitima', true));

    const btnCpfLookup = document.getElementById('btn-lookup-cpf');
    if (btnCpfLookup) btnCpfLookup.addEventListener('click', () => executeCpfLookup(true));

    // Sincronização instantânea ao pular de uma caixa de texto para outra (blur / change / focus / 1º caractere na nova caixa)
    const bindFieldJumpInstantSync = (el, fieldKey) => {
      el.addEventListener('focus', () => {
        if (lastFocusedFichaFieldId && lastFocusedFichaFieldId !== fieldKey && crewDirtySinceLastPush) {
          flushCrewCloudPushNow();
        }
        lastFocusedFichaFieldId = fieldKey;
      });
      el.addEventListener('blur', () => {
        if (crewDirtySinceLastPush) {
          flushCrewCloudPushNow();
        }
      });
      el.addEventListener('change', () => {
        if (el.tagName === 'SELECT' || el.type === 'date' || el.type === 'time' || crewDirtySinceLastPush) {
          flushCrewCloudPushNow();
        }
      });
    };

    const persistTypedFieldWithJumpCheck = (fieldKey) => {
      const switchedBox = Boolean(lastTypedFichaFieldId && lastTypedFichaFieldId !== fieldKey);
      lastTypedFichaFieldId = fieldKey;
      persistFichaDraft(switchedBox ? { immediate: true } : undefined);
    };

    // Inputs simples
    container.querySelectorAll('[data-f]').forEach(inp => {
      const fieldKey = 'f:' + inp.dataset.f;
      bindFieldJumpInstantSync(inp, fieldKey);
      if (inp.dataset.f === 'vitimaTelefone' || inp.dataset.f === 'ocorrenciaContato') {
        inp.addEventListener('blur', () => {
          const key = inp.dataset.f;
          const raw = inp.value;
          if (key === 'vitimaTelefone' || /^\s*[\d()\s+-]+\s*$/.test(String(raw || ''))) {
            const completed = formatPhoneBR(raw, true);
            if (completed !== raw) {
              inp.value = completed;
              fichaState[key] = completed;
              if (key === 'vitimaTelefone') refreshVictimPhoneKindBadge(completed);
              persistFichaDraft({ immediate: true });
            }
          }
        });
      }
      inp.addEventListener('input', () => {
        const key = inp.dataset.f;
        let val = inp.value;

        if (key === 'vitimaTelefone' || (key === 'ocorrenciaContato' && /^\s*[\d()\s+-]*\s*$/.test(String(val || '')))) {
          val = formatPhoneBR(val, false);
          inp.value = val;
          fichaState[key] = val;
          if (key === 'vitimaTelefone') {
            refreshVictimPhoneKindBadge(val);
          }
          persistTypedFieldWithJumpCheck(fieldKey);
          return;
        }

        if (key === 'ocorrenciaCep' || key === 'vitimaCep') {
          const prevDigits = String(fichaState[key] || '').replace(/\D+/g, '');
          val = formatCep(val);
          inp.value = val;
          fichaState[key] = val;
          const curDigits = val.replace(/\D+/g, '');
          if (curDigits.length === 8 && curDigits !== prevDigits && navigator.onLine) {
            executeCepLookup(key === 'ocorrenciaCep' ? 'occ' : 'vitima', false);
          }
          persistTypedFieldWithJumpCheck(fieldKey);
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
            if (curDigits !== prevDigits) {
              pendingCpfSuggestion = null;
              cpfSuggestionDismissedFor = '';
              cpfAutoFilledFromSaved = '';
              if (fichaState._cpfAutoFilled && fichaState._cpfAutoFilled !== curDigits) {
                fichaState._cpfAutoFilled = '';
              }
            }
            if (curDigits.length < 11) {
              if (hint) hint.innerHTML = '';
              refreshCpfManageSlot();
            } else if (curDigits.length === 11 && curDigits !== prevDigits) {
              refreshCpfManageSlot();
              executeCpfLookup(false);
            }
          }
          persistTypedFieldWithJumpCheck(fieldKey);
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
          updateSelectBoxInPlace('med');
        }
        if (key === 'alergiasOutro' && val.trim() && Array.isArray(fichaState.alergiasSelecionadas) && fichaState.alergiasSelecionadas.includes('Nega')) {
          fichaState.alergiasSelecionadas = fichaState.alergiasSelecionadas.filter(x => x !== 'Nega');
          updateSelectBoxInPlace('alergia');
        }

        // Cálculo automático de idade ao preencher DN
        if (key === 'vitimaDn' && val) {
          const calc = calcAgeFromDn(val);
          if (calc) {
            fichaState.vitimaIdade = calc;
            const ageEl = document.getElementById('f-vit-anos');
            if (ageEl) ageEl.value = fichaState.vitimaIdade;
          }
        }
        persistTypedFieldWithJumpCheck(fieldKey);
      });
    });

    // Caixas de seleção compactas (Medicamentos em Uso e Alergias: "Nega" em 1º + ordem alfabética)
    container.querySelectorAll('[data-sbox-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sboxToggle;
        const prev = openSelectBoxKey;
        openSelectBoxKey = (openSelectBoxKey === key) ? '' : key;
        if (prev && prev !== key) updateSelectBoxInPlace(prev);
        updateSelectBoxInPlace(key);
      });
    });

    container.querySelectorAll('[data-sbox-done]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sboxDone;
        if (openSelectBoxKey === key) openSelectBoxKey = '';
        updateSelectBoxInPlace(key);
      });
    });

    container.querySelectorAll('[data-sbox-search]').forEach(inp => {
      inp.addEventListener('input', () => {
        const key = inp.dataset.sboxSearch;
        const q = inp.value || '';
        if (key === 'med') medFilterQuery = q;
        else alergiaFilterQuery = q;
        const qNorm = normStr(q.trim());
        const wrap = document.getElementById(`select-box-${key}`);
        if (wrap) {
          wrap.querySelectorAll(`[data-sbox-opt="${key}"]`).forEach(optBtn => {
            const val = optBtn.dataset.sboxVal || '';
            const show = !qNorm || normStr(val).includes(qNorm);
            optBtn.classList.toggle('hidden', !show);
          });
        }
      });
    });

    container.querySelectorAll('[data-sbox-opt]').forEach(optBtn => {
      optBtn.addEventListener('click', () => {
        const key = optBtn.dataset.sboxOpt;
        const val = optBtn.dataset.sboxVal;
        const isMed = key === 'med';
        const stateProp = isMed ? 'medicamentosSelecionados' : 'alergiasSelecionadas';
        const outroProp = isMed ? 'medicamentosOutro' : 'alergiasOutro';
        const outroId = isMed ? 'inp-med-outro' : 'inp-alergia-outro';

        let cur = Array.isArray(fichaState[stateProp]) ? fichaState[stateProp].slice() : [];
        if (val === 'Nega') {
          if (cur.includes('Nega')) {
            cur = [];
          } else {
            cur = ['Nega'];
            fichaState[outroProp] = '';
            const outroEl = document.getElementById(outroId);
            if (outroEl) outroEl.value = '';
            openSelectBoxKey = ''; // Fecha a caixa automaticamente ao escolher "Nega"
          }
        } else {
          cur = cur.filter(x => x !== 'Nega');
          const idx = cur.indexOf(val);
          if (idx >= 0) cur.splice(idx, 1);
          else cur.push(val);
        }
        fichaState[stateProp] = cur;
        persistFichaDraft({ immediate: true });
        updateSelectBoxInPlace(key);
      });
    });

    container.querySelectorAll('[data-sbox-tags]').forEach(tagsBox => {
      tagsBox.addEventListener('click', (e) => {
        const rmBtn = e.target && e.target.closest ? e.target.closest('[data-sbox-remove]') : null;
        if (!rmBtn) return;
        const key = rmBtn.dataset.sboxRemove;
        const val = rmBtn.dataset.sboxVal;
        const stateProp = (key === 'med') ? 'medicamentosSelecionados' : 'alergiasSelecionadas';
        fichaState[stateProp] = (fichaState[stateProp] || []).filter(x => x !== val);
        persistFichaDraft({ immediate: true });
        updateSelectBoxInPlace(key);
      });
    });

    // Classificação de risco
    container.querySelectorAll('[data-risco]').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = btn.dataset.risco;
        fichaState.risco = (fichaState.risco === r) ? '' : r;
        persistFichaDraft({ immediate: true });
        renderFichaView();
      });
    });

    // Arrays de seleção (chips) — Setor Recomendado e Setor Admitido permitem apenas 1 seleção
    container.querySelectorAll('[data-arr]').forEach(btn => {
      btn.addEventListener('click', () => {
        const arrKey = btn.dataset.arr;
        const val = btn.dataset.val;
        const cur = Array.isArray(fichaState[arrKey]) ? fichaState[arrKey].slice() : [];
        if (arrKey === 'setorRecomendado' || arrKey === 'setorAdmitido') {
          fichaState[arrKey] = cur.includes(val) ? [] : [val];
        } else {
          const i = cur.indexOf(val);
          if (i >= 0) cur.splice(i, 1);
          else cur.push(val);
          fichaState[arrKey] = cur;
        }
        persistFichaDraft({ immediate: true });
        renderFichaView();
      });
    });

    // Copiar endereço da ocorrência para vítima
    const copyAddrBtn = document.getElementById('btn-copy-occ-addr');
    if (copyAddrBtn) {
      copyAddrBtn.addEventListener('click', () => {
        fichaState.vitimaEndereco = fichaState.ocorrenciaEndereco || '';
        fichaState.vitimaNumero = fichaState.ocorrenciaNumero || '';
        persistFichaDraft({ immediate: true });
        renderFichaView();
        showToast('Endereço copiado para os dados da vítima!');
      });
    }

    // Horários + botão AGORA
    container.querySelectorAll('[data-horario]').forEach(inp => {
      const fieldKey = 'h:' + inp.dataset.horario;
      bindFieldJumpInstantSync(inp, fieldKey);
      inp.addEventListener('input', () => {
        fichaState.horarios[inp.dataset.horario] = inp.value;
        persistTypedFieldWithJumpCheck(fieldKey);
      });
    });
    container.querySelectorAll('[data-now]').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.now;
        const t = nowHHMM();
        fichaState.horarios[k] = t;
        persistFichaDraft({ immediate: true });
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
        persistFichaDraft({ immediate: true });
        renderFichaView();
      });
    });

    const clearBurns = document.getElementById('btn-clear-burns');
    if (clearBurns) {
      clearBurns.addEventListener('click', () => {
        fichaState.burnZonesSelected = [];
        fichaState.haQueimaduras = 'NAO';
        fichaState.queimadurasPorcentagem = '';
        persistFichaDraft({ immediate: true });
        renderFichaView();
      });
    }

    // Botões SIM / NÃO Avaliação Primária & Pupilas
    container.querySelectorAll('[data-yn]').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.yn;
        const v = btn.dataset.val;
        fichaState[k] = (fichaState[k] === v) ? '' : v;
        persistFichaDraft({ immediate: true });
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
        persistFichaDraft({ immediate: true });
        renderFichaView();
      });
    }

    container.querySelectorAll('[data-pupil]').forEach(card => {
      card.addEventListener('click', () => {
        const k = card.dataset.pupil;
        const v = card.dataset.val;
        fichaState[k] = (fichaState[k] === v) ? '' : v;
        persistFichaDraft({ immediate: true });
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
        persistFichaDraft({ immediate: true });
        renderFichaView();
      });
    }

    const pullVitBtn = document.getElementById('btn-pull-vitima-termo');
    if (pullVitBtn) {
      pullVitBtn.addEventListener('click', () => {
        fichaState.termoNome = fichaState.vitimaNome || '';
        fichaState.termoCpf = fichaState.vitimaCpf || '';
        persistFichaDraft({ immediate: true });
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
        persistFichaDraft({ immediate: true });
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

    // Etapa 6: Botões para adicionar 2º Enfermagem / 2º Condutor manualmente ou reaplicar assinaturas da equipe
    const btnAddSecondEnf = document.getElementById('btn-add-second-enf');
    if (btnAddSecondEnf) {
      btnAddSecondEnf.addEventListener('click', () => {
        manualShowSecondEnf = true;
        renderFichaView();
      });
    }
    const btnAddSecondCond = document.getElementById('btn-add-second-cond');
    if (btnAddSecondCond) {
      btnAddSecondCond.addEventListener('click', () => {
        manualShowSecondCond = true;
        renderFichaView();
      });
    }
    const btnReapplyCrew = document.getElementById('btn-reapply-crew-sigs');
    if (btnReapplyCrew) {
      btnReapplyCrew.addEventListener('click', () => {
        activeCrew = currentUser ? window.SamuStorage.getActiveCrewForUser(currentUser.username) : null;
        if (activeCrew) {
          applyCrewToFichaState(fichaState, activeCrew, true);
          persistFichaDraft();
          renderFichaView();
          showToast('✅ Nomes, COREN e assinaturas da equipe reaplicados!');
        }
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

    // Etapa 5: Médicos Reguladores salvos automaticamente (1 toque preenche!)
    const inpMedicoReg = document.getElementById('inp-medico-regulador');
    if (inpMedicoReg) {
      inpMedicoReg.addEventListener('change', () => {
        const val = String(inpMedicoReg.value || '').trim();
        if (val.length >= 3 && window.SamuStorage.upsertMedicoRegulador) {
          window.SamuStorage.upsertMedicoRegulador({ nome: val });
          renderFichaView();
        }
      });
    }

    const btnSaveMedicoNow = document.getElementById('btn-save-medico-now');
    if (btnSaveMedicoNow) {
      btnSaveMedicoNow.addEventListener('click', () => {
        const nome = String(fichaState.medicoRegulador || '').trim();
        if (!nome) {
          samuAlert('Digite o nome do Médico Regulador para salvar na lista rápida.');
          return;
        }
        window.SamuStorage.upsertMedicoRegulador({ nome });
        persistFichaDraft();
        renderFichaView();
        showToast(`✅ Médico Regulador salvo para selecionar com 1 toque nas próximas fichas!`);
      });
    }

    container.querySelectorAll('[data-pick-medico]').forEach(chip => {
      chip.addEventListener('click', () => {
        const medId = chip.dataset.pickMedico;
        const found = (window.SamuStorage.getMedicosReguladores() || []).find(m => m.id === medId);
        if (!found) return;
        fichaState.medicoRegulador = found.nome;
        window.SamuStorage.upsertMedicoRegulador(found);
        persistFichaDraft({ immediate: true });
        renderFichaView();
        showToast(`👨‍⚕️ Médico Regulador preenchido: ${found.nome}`);
      });
    });

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
        persistFichaDraft({ immediate: true });
        renderFichaView();
        showToast(`✅ ${nome} salvo! Nas próximas fichas é só tocar no nome e assinar.`);
      });
    }

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
        persistFichaDraft({ immediate: true });
        renderFichaView();

        // Já abre direto a tela de assinatura para o profissional do hospital só assinar!
        window.SamuSignature.open({
          title: `Assinatura – ${found.nome}${found.corenCrm ? ' (' + found.corenCrm + ')' : ''}`,
          initialValue: fichaState.sigRecebido || '',
          allowPersonalSave: false,
          username: ''
        }, (dataUrl) => {
          fichaState.sigRecebido = dataUrl;
          persistFichaDraft({ immediate: true });
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
        const sigOwnerUser = box.dataset.sigUser || (allowPersonal && currentUser ? currentUser.username : '');
        window.SamuSignature.open({
          title: box.dataset.sigTitle || 'Assinatura',
          initialValue: fichaState[key] || '',
          allowPersonalSave: Boolean(allowPersonal && sigOwnerUser),
          username: sigOwnerUser
        }, (dataUrl) => {
          fichaState[key] = dataUrl;
          if (key === 'sigRecebido' && String(fichaState.recebidoPorNome || '').trim()) {
            window.SamuStorage.upsertHospitalReceiver({
              nome: fichaState.recebidoPorNome,
              corenCrm: fichaState.recebidoCorenCrm || '',
              hospital: fichaState.destino || 'HBSA'
            });
          }
          if (currentUser && window.SamuStorage.hasOperationalRole(currentUser)) {
            activeCrew = window.SamuStorage.getActiveCrewForUser(currentUser.username);
          }
          persistFichaDraft({ immediate: true });
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
      const patCheck = await handlePatientCadastroOnFichaSend(fichaState);
      if (!patCheck.proceed) {
        if (patCheck.action === 'cancel' && fichaStep !== 2) {
          fichaStep = 2;
          renderFichaView();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        return;
      }

      const btn = document.getElementById('btn-save-send-ficha');
      btn.disabled = true;
      btn.textContent = 'Gerando PDF e Salvando...';
      try {
        const prevKmFinal = fichaState.kmFinal ? String(fichaState.kmFinal).trim() : '';
        if (prevKmFinal !== '') {
          window.SamuStorage.setLastKmFinal(prevKmFinal);
        }

        const recId = editingFichaId || uid('ficha');
        const existing = editingFichaId ? await window.SamuStorage.getRecordById(editingFichaId) : null;
        const record = buildFichaRecordObject(recId, existing);
        record.isDraft = false;
        record._patientCheckedOnSend = true;

        const generated = await window.SamuPDF.generatePdfForRecord(record);
        await window.SamuStorage.saveRecordLocal(record, { skipPatientUpsert: true });
        if (activeCrew) {
          window.SamuStorage.closeCrewCurrentSession(activeCrew.crewId, currentCrewSessionId, 'submitted', recId, prevKmFinal, false);
        }
        const upRes = await window.SamuStorage.uploadRecordToDrive(record, generated.base64);
        await window.SamuStorage.clearDraft(currentUser.username, 'ficha');

        // Prepara nova ficha limpa para o próximo atendimento (já puxando o último KM Final como KM Inicial e assinaturas da equipe!)
        editingFichaId = null;
        manualShowSecondEnf = false;
        manualShowSecondCond = false;
        fichaState = createEmptyFicha();
        fichaStep = 1;
        resetFichaSyncTracking(fichaState, uid('sf'), {}, false);
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
    const crewObj = (currentUser && window.SamuStorage.hasOperationalRole(currentUser))
      ? window.SamuStorage.getActiveCrewForUser(currentUser.username)
      : null;

    return {
      id,
      type: 'ficha',
      date: d.data || todayISO(),
      createdAt: (existing && existing.createdAt) ? existing.createdAt : new Date().toISOString(),
      createdBy: (existing && existing.createdBy) ? existing.createdBy : currentUser.username,
      createdByName: (existing && existing.createdByName) ? existing.createdByName : currentUser.name,
      createdByRole: (existing && existing.createdByRole) ? existing.createdByRole : currentUser.role,
      crewId: (crewObj && crewObj.crewId) || (existing && existing.crewId) || '',
      crewMembers: (crewObj && Array.isArray(crewObj.members))
        ? crewObj.members.slice()
        : ((existing && Array.isArray(existing.crewMembers)) ? existing.crewMembers : [currentUser.username]),
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
    if (!isChecklistAllowed('condutor', currentUser)) {
      activeTab = 'ficha';
      renderBottomNav({ skipRedirectRender: true });
      return renderFichaView();
    }
    const container = document.getElementById('main-view');
    const isAdminUser = window.SamuStorage.isUserAdmin(currentUser);
    const modCfg = getChecklistModulesCfg();
    const admDisabledBannerHtml = (isAdminUser && !modCfg.condutorEnabled)
      ? `<div style="background:#fef2f2; border:1.5px solid #fca5a5; border-radius:10px; padding:9px 12px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="font-size:0.81rem; color:#991b1b; line-height:1.35;">
            🔒 <strong>Visão Exclusiva ADM:</strong> O Check List dos <strong>Motoristas / Condutores</strong> está <strong>DESATIVADO</strong> e não aparece para funcionários não-ADM.
          </div>
          <button type="button" class="btn btn-success btn-sm" id="btn-adm-quick-enable-cond">✅ Ativar p/ Motoristas</button>
        </div>`
      : '';
    const d = condutorState;
    if (!editingCondutorId) {
      applySharedDailyToCondutorState(d, { replaceOtherShift: false });
    }
    const isDiurno = d.turnoAtivo === 'DIURNO';
    const itensMap = isDiurno ? d.itensDiurno : d.itensNoturno;
    const avariasArr = isDiurno ? d.avariasDiurno : d.avariasNoturno;
    const allItems = window.SAMU_SCHEMA.condutorLeftItems.concat(window.SAMU_SCHEMA.condutorRightItems);
    const filledCount = allItems.filter(it => Boolean(String(itensMap[it.id] || '').trim())).length;
    const diurnoLoadedCount = allItems.filter(it => Boolean(String((d.itensDiurno || {})[it.id] || '').trim())).length;
    const printCfg = window.SamuStorage.getRemotePrintConfig ? window.SamuStorage.getRemotePrintConfig() : { autoPrintChecklists: true, checklistPrintShift: 'noturno_only' };
    const isNoturnoOnlyPrint = Boolean(printCfg.autoPrintChecklists && printCfg.checklistPrintShift !== 'all');

    const val = validateCondutorChecklist(d);
    if (condutorValidationActive && val.valid) {
      condutorValidationActive = false;
    }
    const showErr = condutorValidationActive && !val.valid;
    const abastStatus = getCondutorAbastStatus(d);

    const shiftPrintBannerHtml = isNoturnoOnlyPrint
      ? (isDiurno
        ? `<div style="background:#eff6ff; border:1.5px solid #93c5fd; border-radius:10px; padding:8px 11px; margin-bottom:10px; font-size:0.8rem; color:#1e3a8a; line-height:1.35;">
            ☀️ <strong>Plantão Diurno:</strong> ao salvar e enviar, sua conferência fica arquivada no Google Drive e sincronizada para o <strong>Plantão Noturno</strong> completar a mesma folha. <strong>A impressão automática na Base ocorre à noite</strong> quando o Check List fica 100% preenchido.
          </div>`
        : (diurnoLoadedCount > 0
          ? `<div style="background:#f0fdf4; border:1.5px solid #86efac; border-radius:10px; padding:8px 11px; margin-bottom:10px; font-size:0.8rem; color:#14532d; line-height:1.35;">
              🌙 <strong>Folha Completa (Diurno + Noturno):</strong> os dados do turno Diurno${d.condutorDiurno ? ` (<strong>${escapeHtml(d.condutorDiurno)}</strong>)` : ''} já estão carregados nesta folha (${diurnoLoadedCount}/${allItems.length} itens)! Ao enviar ao Google Drive, o <strong>PDF completo será impresso automaticamente na Base SAMU</strong>.
            </div>`
          : `<div style="background:#fefce8; border:1.5px solid #fde047; border-radius:10px; padding:8px 11px; margin-bottom:10px; font-size:0.8rem; color:#854d0e; line-height:1.35;">
              🌙 <strong>Plantão Noturno:</strong> ao salvar e enviar ao Google Drive, este Check List será <strong>enviado automaticamente para impressão na Base SAMU</strong>.
            </div>`))
      : '';

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
        <div>
          <strong style="font-size:1.05rem;">🚑 Check List – Condutor / Socorrista</strong>
          <div style="font-size:0.78rem; color:var(--muted);">Conferidos no turno: ${filledCount} de ${allItems.length} itens</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-reset-condutor">🗑️ Limpar</button>
      </div>

      ${admDisabledBannerHtml}

      ${renderQuickDraftBarHtml('condutor')}

      ${shiftPrintBannerHtml}

      <div id="cond-validation-banner-slot">${showErr ? renderChecklistValidationBannerHtml(val) : ''}</div>

      <div class="card">
        <div class="card-title"><span>📋 Identificação do Plantão e Viatura</span></div>
        <div class="grid-2">
          <div class="field ${showErr && val.invalidFields.has('data') ? 'field-invalid' : ''}" id="cond-field-data">
            <label>Data *</label>
            <input type="date" id="cond-data" value="${escapeHtml(d.data)}" />
          </div>
          <div class="field ${showErr && val.invalidFields.has('turnoAtivo') ? 'field-invalid' : ''}" id="cond-field-turno">
            <label>Turno sendo Preenchido *</label>
            <select id="cond-turno">
              <option value="DIURNO" ${isDiurno ? 'selected' : ''}>☀️ PLANTÃO DIURNO</option>
              <option value="NOTURNO" ${!isDiurno ? 'selected' : ''}>🌙 PLANTÃO NOTURNO</option>
            </select>
          </div>
        </div>

        <div class="field ${showErr && val.invalidFields.has('viaturaId') ? 'field-invalid' : ''}" id="cond-field-viatura" style="margin-bottom:10px;">
          <div class="section-subtitle" style="margin-top:4px;">Selecione a Viatura *</div>
          <div class="grid-2-compact">
            ${window.SAMU_SCHEMA.viaturas.map(v => {
              const savedCnt = v.id === 'outra'
                ? (d.viaturaId === 'outra' ? window.SamuStorage.getViaturaAvarias('outra', d.outraPlaca).length : 0)
                : window.SamuStorage.getViaturaAvarias(v.id, '').length;
              return `
                <button type="button" class="chip-btn ${d.viaturaId === v.id ? 'selected' : ''}" data-viatura="${v.id}" style="text-align:left;">
                  <strong>${v.label}</strong>${v.placa ? `<br><small>Placa: ${v.placa}</small>` : ''}
                  ${savedCnt > 0 ? `<br><small style="color:#c2410c; font-weight:800;">📌 ${savedCnt} avaria(s) salva(s)</small>` : ''}
                </button>
              `;
            }).join('')}
          </div>
        </div>
        ${d.viaturaId === 'outra' ? `
          <div class="field ${showErr && val.invalidFields.has('outraPlaca') ? 'field-invalid' : ''}" id="cond-field-outra-placa">
            <label>Informe Modelo / Placa da Outra Viatura *</label>
            <input type="text" id="cond-outra-placa" placeholder="Ex: Mercedes Sprinter - ABC 1D23" value="${escapeHtml(d.outraPlaca)}" />
          </div>
        ` : ''}

        <div class="grid-2">
          <div class="field ${showErr && val.invalidFields.has('condutorDiurno') ? 'field-invalid' : ''}" id="cond-field-nome-diurno">
            <label>Condutor Diurno ${isDiurno ? '*' : ''}</label>
            <input type="text" id="cond-nome-diurno" value="${escapeHtml(d.condutorDiurno)}" />
          </div>
          <div class="field ${showErr && val.invalidFields.has('condutorNoturno') ? 'field-invalid' : ''}" id="cond-field-nome-noturno">
            <label>Condutor Noturno ${!isDiurno ? '*' : ''}</label>
            <input type="text" id="cond-nome-noturno" value="${escapeHtml(d.condutorNoturno)}" />
          </div>
        </div>

        <div class="field ${showErr && val.invalidFields.has('abastRealizado') ? 'field-invalid' : ''}" id="cond-field-abast-status" style="margin-top:4px; margin-bottom:${abastStatus === 'SIM' ? '10px' : '0'};">
          <label>Realizou Abastecimento no Plantão? *</label>
          <div class="grid-2" style="margin-top:4px;">
            <button type="button" class="chip-btn ${abastStatus === 'NAO' ? 'selected' : ''}" data-abast-choice="NAO">🚫 Não houve abastecimento</button>
            <button type="button" class="chip-btn ${abastStatus === 'SIM' ? 'selected' : ''}" data-abast-choice="SIM">⛽ Sim, houve abastecimento</button>
          </div>
        </div>
        ${abastStatus === 'SIM' ? `
          <div class="grid-abast">
            <div class="field ${showErr && val.invalidFields.has('abastLitros') ? 'field-invalid' : ''}" id="cond-field-abast-l">
              <label>Litros *</label>
              <input type="text" id="cond-abast-l" placeholder="Ex: 48 L" value="${escapeHtml(d.abastLitros)}" />
            </div>
            <div class="field ${showErr && val.invalidFields.has('abastKm') ? 'field-invalid' : ''}" id="cond-field-abast-km">
              <label>KM *</label>
              <input type="number" id="cond-abast-km" placeholder="KM" value="${escapeHtml(d.abastKm)}" />
            </div>
            <div class="field field-full-phone ${showErr && val.invalidFields.has('abastHora') ? 'field-invalid' : ''}" id="cond-field-abast-h">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                <label style="margin:0;">Hora do Abastecimento *</label>
                <button type="button" class="btn-quick-fill" id="btn-abast-hora-now" style="padding:2px 8px; font-size:0.74rem;">⏱ Agora</button>
              </div>
              <input type="time" id="cond-abast-h" value="${escapeHtml(d.abastHora)}" />
            </div>
          </div>
          <div class="field ${showErr && val.invalidFields.has('sigAbastecimento') ? 'field-invalid' : ''}" id="cond-field-abast-sig" style="margin-top:2px; margin-bottom:0;">
            <label style="${showErr && val.invalidFields.has('sigAbastecimento') ? 'color:#b91c1c;' : ''}">Assinatura do Abastecimento (com o dedo na tela) *</label>
            <div class="sig-preview-box ${d.sigAbastecimento ? 'signed' : ''} ${showErr && val.invalidFields.has('sigAbastecimento') ? 'sig-invalid' : ''}" id="cond-abast-sig-box" style="min-height:86px;">
              ${d.sigAbastecimento
                ? `<img src="${d.sigAbastecimento}" alt="Assinatura Abastecimento" />`
                : (d.abastAss
                  ? `<span>✍️ Assinado (texto legado: ${escapeHtml(d.abastAss)}) — Toque para assinar com o dedo</span>`
                  : `<span>✍️ Toque aqui para assinar o Abastecimento com o dedo</span>`)}
            </div>
          </div>
        ` : ''}
      </div>

      <div class="card">
        <div class="card-title">
          <span>✅ Itens da Viatura (${isDiurno ? 'Coluna Diurno' : 'Coluna Noturno'}) *</span>
          <button type="button" class="btn btn-success btn-sm" id="btn-cond-all-ok">✅ Marcar Todos OK</button>
        </div>
        <p style="margin:0 0 10px; font-size:0.8rem; color:var(--muted);">
          Legenda oficial: <strong>OK</strong>=Normal • <strong>A</strong>=Amassado • <strong>D</strong>=Danificado • <strong>F</strong>=Falta • <strong>Q</strong>=Queimado • <strong>R</strong>=Riscado
        </p>

        <div>
          ${allItems.map(it => {
            const cur = itensMap[it.id] || '';
            const rowInvalid = showErr && val.missingItemIds.has(it.id);
            return `
              <div class="check-item-row ${rowInvalid ? 'item-invalid' : ''}" id="cond-item-row-${it.id}">
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
        ${(() => {
          const curVObj = window.SAMU_SCHEMA.viaturas.find(v => v.id === d.viaturaId);
          const curVName = d.viaturaId === 'outra'
            ? (d.outraPlaca || 'Outra Viatura')
            : (curVObj ? `${curVObj.label} (${curVObj.placa})` : 'Viatura');
          const cnt = (avariasArr || []).length;
          return `
            <div style="background:#fffbeb; border:1.5px solid #fcd34d; border-radius:10px; padding:8px 10px; margin-bottom:8px; font-size:0.8rem; color:#92400e; line-height:1.35;">
              💾 <strong>Memória por Viatura ativa (${escapeHtml(curVName)}):</strong>
              ${cnt > 0
                ? `<strong>${cnt} parte(s) amassada(s)/riscada(s) salva(s)</strong> nesta viatura — já carregam prontas nos próximos plantões.`
                : `nenhuma avaria salva nesta viatura no momento. Ao marcar um amassado ou riscado abaixo, ele já fica salvo para os próximos plantões.`}
            </div>
          `;
        })()}
        <p style="margin:0 0 8px; font-size:0.83rem; color:var(--muted);">
          Escolha o tipo de avaria abaixo e <strong>toque em cima do desenho da ambulância</strong> onde houver detalhe (toque num ponto azul marcado para removê-lo quando for reparado):
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

        <div class="field ${showErr && val.invalidFields.has('obsTurno') ? 'field-invalid' : ''}" id="cond-field-obs" style="margin-top:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:4px; flex-wrap:wrap;">
            <label style="margin:0;">Observações ${isDiurno ? 'Diurno' : 'Noturna'} *</label>
            <button type="button" class="btn-quick-fill" id="btn-cond-obs-sem-alt">✅ Sem alterações</button>
          </div>
          <textarea rows="4" id="cond-obs-turno" placeholder="Obrigatório: registre anormalidade, falta de material, avaria ou toque em 'Sem alterações'...">${escapeHtml(isDiurno ? d.obsDiurno : d.obsNoturno)}</textarea>
        </div>

        <div class="field">
          <label style="${showErr && val.invalidFields.has('sigTurno') ? 'color:#b91c1c;' : ''}">Assinatura na Tela – Condutor ${isDiurno ? 'Diurno' : 'Noturno'} *</label>
          <div class="sig-preview-box ${(isDiurno ? d.sigCondutorDiurno : d.sigCondutorNoturno) ? 'signed' : ''} ${showErr && val.invalidFields.has('sigTurno') ? 'sig-invalid' : ''}" id="cond-sig-box">
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
    bindStepPillsHorizontalScroll(container);

    const saveCondDraft = () => {
      if (!editingCondutorId && currentUser) {
        window.SamuStorage.saveDraft(currentUser.username, 'checklist_condutor', condutorState);
      }
    };

    const refreshCondValidationInPlace = () => {
      if (!condutorValidationActive) return;
      const v = validateCondutorChecklist(d);
      const slot = document.getElementById('cond-validation-banner-slot');
      if (v.valid) {
        condutorValidationActive = false;
        if (slot) slot.innerHTML = '';
      } else if (slot) {
        slot.innerHTML = renderChecklistValidationBannerHtml(v);
      }
      const fieldPairs = [
        ['data', 'cond-field-data'],
        ['turnoAtivo', 'cond-field-turno'],
        ['viaturaId', 'cond-field-viatura'],
        ['outraPlaca', 'cond-field-outra-placa'],
        ['condutorDiurno', 'cond-field-nome-diurno'],
        ['condutorNoturno', 'cond-field-nome-noturno'],
        ['abastRealizado', 'cond-field-abast-status'],
        ['abastLitros', 'cond-field-abast-l'],
        ['abastHora', 'cond-field-abast-h'],
        ['abastKm', 'cond-field-abast-km'],
        ['sigAbastecimento', 'cond-field-abast-sig'],
        ['obsTurno', 'cond-field-obs']
      ];
      fieldPairs.forEach(([key, domId]) => {
        const el = document.getElementById(domId);
        if (el) el.classList.toggle('field-invalid', !v.valid && v.invalidFields.has(key));
      });
    };

    document.getElementById('btn-reset-condutor').addEventListener('click', async () => {
      if (!(await samuConfirm('Limpar os campos deste Check List de Condutor? (As avarias salvas da viatura serão mantidas)'))) return;
      const keepViatura = d.viaturaId || 'master_29';
      const keepOutraPlaca = d.outraPlaca || '';
      editingCondutorId = null;
      condutorValidationActive = false;
      condutorState = createEmptyCondutor();
      condutorState.viaturaId = keepViatura;
      condutorState.outraPlaca = keepOutraPlaca;
      applySavedAvariasToCondutorState(condutorState, true);
      applySharedDailyToCondutorState(condutorState, { replaceOtherShift: true });
      await window.SamuStorage.clearDraft(currentUser.username, 'checklist_condutor');
      renderCondutorView();
    });

    document.getElementById('cond-data').addEventListener('input', e => {
      d.data = e.target.value;
      saveCondDraft();
      refreshCondValidationInPlace();
    });
    document.getElementById('cond-data').addEventListener('change', () => {
      if (!editingCondutorId) {
        applySharedDailyToCondutorState(d, { replaceOtherShift: true });
        saveCondDraft();
        renderCondutorView();
      }
    });
    document.getElementById('cond-turno').addEventListener('change', e => {
      d.turnoAtivo = e.target.value;
      const mySavedSig = currentUser ? (window.SamuStorage.getSavedSignature(currentUser.username) || '') : '';
      if (d.turnoAtivo === 'DIURNO' && currentUser) {
        if (!d.condutorDiurno) d.condutorDiurno = currentUser.name;
        if (!d.sigCondutorDiurno && mySavedSig) d.sigCondutorDiurno = mySavedSig;
      }
      if (d.turnoAtivo === 'NOTURNO' && currentUser) {
        if (!d.condutorNoturno) d.condutorNoturno = currentUser.name;
        if (!d.sigCondutorNoturno && mySavedSig) d.sigCondutorNoturno = mySavedSig;
      }
      if (!editingCondutorId) {
        applySavedAvariasToCondutorState(d, true);
        applySharedDailyToCondutorState(d, { replaceOtherShift: false });
      }
      saveCondDraft();
      renderCondutorView();
    });

    container.querySelectorAll('[data-viatura]').forEach(btn => {
      btn.addEventListener('click', () => {
        d.viaturaId = btn.dataset.viatura;
        if (!editingCondutorId) {
          applySavedAvariasToCondutorState(d, true);
          applySharedDailyToCondutorState(d, { replaceOtherShift: true });
        }
        saveCondDraft();
        renderCondutorView();
      });
    });

    const outraInp = document.getElementById('cond-outra-placa');
    if (outraInp) {
      outraInp.addEventListener('input', e => {
        d.outraPlaca = e.target.value;
        saveCondDraft();
        refreshCondValidationInPlace();
      });
      outraInp.addEventListener('change', () => {
        if (!editingCondutorId) {
          applySavedAvariasToCondutorState(d, true);
          applySharedDailyToCondutorState(d, { replaceOtherShift: true });
          saveCondDraft();
          renderCondutorView();
        }
      });
    }

    document.getElementById('cond-nome-diurno').addEventListener('input', e => { d.condutorDiurno = e.target.value; saveCondDraft(); refreshCondValidationInPlace(); });
    document.getElementById('cond-nome-noturno').addEventListener('input', e => { d.condutorNoturno = e.target.value; saveCondDraft(); refreshCondValidationInPlace(); });

    container.querySelectorAll('[data-abast-choice]').forEach(btn => {
      btn.addEventListener('click', () => {
        const choice = btn.dataset.abastChoice;
        d.abastRealizado = choice;
        d._abastFromShared = false;
        if (choice === 'NAO') {
          d.abastLitros = '';
          d.abastHora = '';
          d.abastKm = '';
          d.abastAss = '';
          d.sigAbastecimento = '';
        }
        saveCondDraft();
        renderCondutorView();
      });
    });

    const abastL = document.getElementById('cond-abast-l');
    const abastH = document.getElementById('cond-abast-h');
    const abastKm = document.getElementById('cond-abast-km');
    const btnAbastHoraNow = document.getElementById('btn-abast-hora-now');
    const abastSigBox = document.getElementById('cond-abast-sig-box');
    if (abastL) abastL.addEventListener('input', e => { d.abastRealizado = 'SIM'; d._abastFromShared = false; d.abastLitros = e.target.value; saveCondDraft(); refreshCondValidationInPlace(); });
    if (abastH) abastH.addEventListener('input', e => { d.abastRealizado = 'SIM'; d._abastFromShared = false; d.abastHora = e.target.value; saveCondDraft(); refreshCondValidationInPlace(); });
    if (abastKm) abastKm.addEventListener('input', e => { d.abastRealizado = 'SIM'; d._abastFromShared = false; d.abastKm = e.target.value; saveCondDraft(); refreshCondValidationInPlace(); });
    if (btnAbastHoraNow && abastH) {
      btnAbastHoraNow.addEventListener('click', () => {
        const t = nowHHMM();
        d.abastRealizado = 'SIM';
        d._abastFromShared = false;
        d.abastHora = t;
        abastH.value = t;
        saveCondDraft();
        refreshCondValidationInPlace();
        showToast(`Horário do abastecimento: ${t}`);
      });
    }
    if (abastSigBox) {
      abastSigBox.addEventListener('click', () => {
        window.SamuSignature.open({
          title: 'Assinatura – Abastecimento da Viatura',
          subtitle: 'Assine com o dedo no quadro abaixo',
          initialValue: d.sigAbastecimento || '',
          allowPersonalSave: true,
          username: currentUser ? currentUser.username : ''
        }, (dataUrl) => {
          d.abastRealizado = 'SIM';
          d._abastFromShared = false;
          d.sigAbastecimento = dataUrl;
          saveCondDraft();
          renderCondutorView();
        });
      });
    }

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

    const persistViaturaMarksNow = (marksList) => {
      if (!editingCondutorId && window.SamuStorage.saveViaturaAvarias) {
        window.SamuStorage.saveViaturaAvarias(
          d.viaturaId || 'master_29',
          d.outraPlaca || '',
          marksList,
          currentUser ? currentUser.username : ''
        );
      }
    };

    const ambStage = document.getElementById('amb-stage');
    ambStage.addEventListener('click', (e) => {
      if (e.target.dataset.pinIdx !== undefined) {
        const idx = Number(e.target.dataset.pinIdx);
        avariasArr.splice(idx, 1);
        persistViaturaMarksNow(avariasArr);
        saveCondDraft();
        renderCondutorView();
        showToast('Marcação removida da memória desta viatura.');
        return;
      }
      const rect = ambStage.getBoundingClientRect();
      const x = Math.max(0.03, Math.min(0.97, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0.03, Math.min(0.97, (e.clientY - rect.top) / rect.height));
      avariasArr.push({ x, y, code: activeDamageCode });
      persistViaturaMarksNow(avariasArr);
      saveCondDraft();
      renderCondutorView();
      showToast(`💾 Avaria "${activeDamageCode}" salva nesta viatura para os próximos plantões!`);
    });

    document.getElementById('btn-clear-avarias').addEventListener('click', async () => {
      if (!avariasArr || avariasArr.length === 0) {
        showToast('Nenhuma marcação nesta viatura para limpar.');
        return;
      }
      if (!(await samuConfirm('Remover todas as partes amassadas/riscadas salvas desta viatura (ex.: após reparo ou funilaria)?'))) {
        return;
      }
      if (isDiurno) d.avariasDiurno = [];
      else d.avariasNoturno = [];
      persistViaturaMarksNow([]);
      saveCondDraft();
      renderCondutorView();
      showToast('Marcações salvas desta viatura foram limpas.');
    });

    const condObsInp = document.getElementById('cond-obs-turno');
    condObsInp.addEventListener('input', e => {
      if (isDiurno) d.obsDiurno = e.target.value;
      else d.obsNoturno = e.target.value;
      saveCondDraft();
      refreshCondValidationInPlace();
    });

    const btnObsSemAlt = document.getElementById('btn-cond-obs-sem-alt');
    if (btnObsSemAlt) {
      btnObsSemAlt.addEventListener('click', () => {
        const cur = String((isDiurno ? d.obsDiurno : d.obsNoturno) || '').trim();
        const nextVal = cur || 'Sem alterações.';
        if (isDiurno) d.obsDiurno = nextVal;
        else d.obsNoturno = nextVal;
        condObsInp.value = nextVal;
        saveCondDraft();
        refreshCondValidationInPlace();
        showToast(cur ? 'Observações já preenchidas!' : 'Observações preenchidas: Sem alterações.');
      });
    }

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
      if (!editingCondutorId) {
        applySharedDailyToCondutorState(d, { replaceOtherShift: false });
      }
      await openPdfPreviewModal(buildCondRecord(editingCondutorId || uid('ckcond')));
    });

    document.getElementById('btn-save-send-condutor').addEventListener('click', async () => {
      const checkVal = validateCondutorChecklist(d);
      if (!checkVal.valid) {
        condutorValidationActive = true;
        renderCondutorView();
        scrollToMissingChecklistField(checkVal.firstMissingDomId);
        await samuAlert(
          '⚠️ Preencha todos os campos do Check List antes de enviar:\n\n• ' +
          checkVal.errors.join('\n• ')
        );
        return;
      }

      const btn = document.getElementById('btn-save-send-condutor');
      btn.disabled = true;
      btn.textContent = 'Gerando PDF e Salvando...';
      try {
        if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
          await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: false }).catch(() => {});
        }
        applySharedDailyToCondutorState(d, { replaceOtherShift: false });
        if (window.SamuStorage.saveViaturaAvarias) {
          window.SamuStorage.saveViaturaAvarias(
            d.viaturaId || 'master_29',
            d.outraPlaca || '',
            isDiurno ? d.avariasDiurno : d.avariasNoturno,
            currentUser ? currentUser.username : ''
          );
        }
        if (window.SamuStorage.saveSharedDailyChecklist) {
          await window.SamuStorage.saveSharedDailyChecklist('condutor', d, currentUser);
        }
        const keepViatura = d.viaturaId || 'master_29';
        const keepOutraPlaca = d.outraPlaca || '';
        const recId = editingCondutorId || uid('ckcond');
        const existing = editingCondutorId ? await window.SamuStorage.getRecordById(editingCondutorId) : null;
        const record = buildCondRecord(recId, existing);
        const generated = await window.SamuPDF.generatePdfForRecord(record);
        await window.SamuStorage.saveRecordLocal(record);
        const upRes = await window.SamuStorage.uploadRecordToDrive(record, generated.base64);
        await window.SamuStorage.clearDraft(currentUser.username, 'checklist_condutor');

        editingCondutorId = null;
        condutorValidationActive = false;
        condutorState = createEmptyCondutor();
        condutorState.viaturaId = keepViatura;
        condutorState.outraPlaca = keepOutraPlaca;
        applySavedAvariasToCondutorState(condutorState, true);
        applySharedDailyToCondutorState(condutorState, { replaceOtherShift: false });
        await refreshDraftCount();
        await refreshSyncBadge();
        await openPdfPreviewModal(record, generated, upRes);
        renderCondutorView();
      } catch (err) {
        samuAlert('Erro ao salvar Check List: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 Salvar e Enviar PDF ao Google Drive';
      }
    });

    const btnQuickEnCond = document.getElementById('btn-adm-quick-enable-cond');
    if (btnQuickEnCond) {
      btnQuickEnCond.addEventListener('click', async () => {
        btnQuickEnCond.disabled = true;
        await window.SamuStorage.saveChecklistModulesConfig({ condutorEnabled: true }, currentUser && currentUser.username);
        renderBottomNav();
        await refreshDraftCount();
        await refreshSyncBadge();
        renderCondutorView();
        showToast('✅ Check List dos Motoristas ATIVADO para os funcionários!');
      });
    }
  }

  /* ==========================================================================
   * ABA 3: CHECK LIST – ENFERMAGEM (CHECAGEM DIÁRIA USB – 10 COMPARTIMENTOS)
   * ========================================================================== */
  function renderEnfermagemView() {
    if (!isChecklistAllowed('enfermagem', currentUser)) {
      activeTab = 'ficha';
      renderBottomNav({ skipRedirectRender: true });
      return renderFichaView();
    }
    const container = document.getElementById('main-view');
    const isAdminUser = window.SamuStorage.isUserAdmin(currentUser);
    const modCfg = getChecklistModulesCfg();
    const admDisabledBannerHtml = (isAdminUser && !modCfg.enfermagemEnabled)
      ? `<div style="background:#fef2f2; border:1.5px solid #fca5a5; border-radius:10px; padding:9px 12px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="font-size:0.81rem; color:#991b1b; line-height:1.35;">
            🔒 <strong>Visão Exclusiva ADM:</strong> O Check List da <strong>Enfermagem</strong> está <strong>DESATIVADO</strong> e não aparece para funcionários não-ADM.
          </div>
          <button type="button" class="btn btn-success btn-sm" id="btn-adm-quick-enable-enf">✅ Ativar p/ Enfermagem</button>
        </div>`
      : '';
    const d = enfermagemState;
    if (!editingEnfermagemId) {
      applySharedDailyToEnfermagemState(d, { replaceOtherShift: false });
    }
    const isDia = d.turno === 'DIA';
    const targetMap = isDia ? d.itensDia : d.itensNoite;
    const sections = window.SAMU_SCHEMA.enfermagemSections;
    if (activeEnfSectionIdx >= sections.length) activeEnfSectionIdx = 0;
    const activeSec = sections[activeEnfSectionIdx];

    const totalAll = sections.reduce((acc, s) => acc + s.items.length, 0);
    const doneAll = sections.reduce((acc, s) => acc + s.items.filter(i => Boolean(String(targetMap[i.id] || '').trim())).length, 0);
    const diaLoadedCount = sections.reduce((acc, s) => acc + s.items.filter(i => Boolean(String((d.itensDia || {})[i.id] || '').trim())).length, 0);
    const printCfg = window.SamuStorage.getRemotePrintConfig ? window.SamuStorage.getRemotePrintConfig() : { autoPrintChecklists: true, checklistPrintShift: 'noturno_only' };
    const isNoturnoOnlyPrint = Boolean(printCfg.autoPrintChecklists && printCfg.checklistPrintShift !== 'all');

    const val = validateEnfermagemChecklist(d);
    if (enfermagemValidationActive && val.valid) {
      enfermagemValidationActive = false;
    }
    const showErr = enfermagemValidationActive && !val.valid;

    const enfShiftPrintBannerHtml = isNoturnoOnlyPrint
      ? (isDia
        ? `<div style="background:#eff6ff; border:1.5px solid #93c5fd; border-radius:10px; padding:8px 11px; margin-bottom:10px; font-size:0.8rem; color:#1e3a8a; line-height:1.35;">
            ☀️ <strong>Plantão Diurno (CK DIA):</strong> ao salvar e enviar, sua conferência fica arquivada no Google Drive e sincronizada para o <strong>CK NOITE</strong> completar a mesma folha. <strong>A impressão automática na Base ocorre à noite</strong> quando a folha fica 100% preenchida.
          </div>`
        : (diaLoadedCount > 0
          ? `<div style="background:#f0fdf4; border:1.5px solid #86efac; border-radius:10px; padding:8px 11px; margin-bottom:10px; font-size:0.8rem; color:#14532d; line-height:1.35;">
              🌙 <strong>Folha Completa (CK DIA + CK NOITE):</strong> a conferência do CK DIA${d.responsavelDiaNome ? ` (<strong>${escapeHtml(d.responsavelDiaNome)}</strong>)` : ''} já está carregada nesta folha (${diaLoadedCount}/${totalAll} materiais)! Ao enviar ao Google Drive, o <strong>PDF completo será impresso automaticamente na Base SAMU</strong>.
            </div>`
          : `<div style="background:#fefce8; border:1.5px solid #fde047; border-radius:10px; padding:8px 11px; margin-bottom:10px; font-size:0.8rem; color:#854d0e; line-height:1.35;">
              🌙 <strong>Plantão Noturno (CK NOITE):</strong> ao salvar e enviar ao Google Drive, este Check List será <strong>enviado automaticamente para impressão na Base SAMU</strong>.
            </div>`))
      : '';

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
        <div>
          <strong style="font-size:1.05rem;">🩺 Checagem Diária USB – Enfermagem</strong>
          <div id="enf-top-counter" style="font-size:0.78rem; color:var(--muted);">Total conferido (${isDia ? 'CK DIA' : 'CK NOITE'}): ${doneAll} de ${totalAll} materiais</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button type="button" class="btn btn-success btn-sm" id="btn-enf-all-ok">✅ Tudo OK</button>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-reset-enf">🗑️ Limpar</button>
        </div>
      </div>

      ${admDisabledBannerHtml}

      ${renderQuickDraftBarHtml('enfermagem')}

      ${enfShiftPrintBannerHtml}

      <div id="enf-validation-banner-slot">${showErr ? renderChecklistValidationBannerHtml(val) : ''}</div>

      <div class="card">
        <div class="grid-enf-header">
          <div class="field ${showErr && val.invalidFields.has('data') ? 'field-invalid' : ''}" id="enf-field-data">
            <label>Data *</label>
            <input type="date" id="enf-data" value="${escapeHtml(d.data)}" />
          </div>
          <div class="field ${showErr && val.invalidFields.has('turno') ? 'field-invalid' : ''}" id="enf-field-turno">
            <label>Turno *</label>
            <select id="enf-turno">
              <option value="DIA" ${isDia ? 'selected' : ''}>☀️ CK DIA</option>
              <option value="NOITE" ${!isDia ? 'selected' : ''}>🌙 CK NOITE</option>
            </select>
          </div>
          <div class="field ${showErr && val.invalidFields.has('responsavelNome') ? 'field-invalid' : ''}" id="enf-field-nome">
            <label>Profissional Enfermagem *</label>
            <input type="text" id="enf-nome" value="${escapeHtml(d.responsavelNome)}" />
          </div>
          <div class="field ${showErr && val.invalidFields.has('responsavelCoren') ? 'field-invalid' : ''}" id="enf-field-coren">
            <label>COREN *</label>
            <input type="text" id="enf-coren" value="${escapeHtml(d.responsavelCoren)}" />
          </div>
        </div>
      </div>

      ${renderStepPillsBarHtml('enf-sections', sections.map((sec, idx) => {
        const secDone = sec.items.filter(it => Boolean(String(targetMap[it.id] || '').trim())).length;
        const pillInc = showErr && val.incompleteSecIdxs.has(idx);
        return `<button type="button" class="step-pill ${idx === activeEnfSectionIdx ? 'active' : ''} ${pillInc ? 'pill-incomplete' : ''}" data-enf-sec="${idx}">
          ${sec.title} (${secDone}/${sec.items.length})
        </button>`;
      }).join(''))}

      <div class="card">
        <div class="card-title">
          <span style="color:${activeSec.color};">🎒 ${activeSec.title}</span>
          <button type="button" class="btn btn-success btn-sm" id="btn-sec-ok">✅ Marcar Seção OK</button>
        </div>

        <div>
          ${activeSec.items.map(it => {
            const itemVal = targetMap[it.id] || '';
            const rowInvalid = showErr && val.missingItemIds.has(it.id);
            return `
              <div class="check-item-row ${rowInvalid ? 'item-invalid' : ''}" id="enf-item-row-${it.id}">
                <div class="check-item-info">
                  <span class="check-item-qty">Qtd: ${it.qty}</span>
                  <span class="check-item-name">${it.name}</span>
                </div>
                <div class="code-pills" style="align-items:center;">
                  ${it.customInput ? `
                    <input type="text" data-enf-custom="${it.id}" placeholder="${it.placeholder || 'Libras'}"
                      value="${escapeHtml(itemVal)}"
                      style="width:126px; padding:7px 10px; border:1.5px solid ${rowInvalid ? '#dc2626' : 'var(--border)'}; border-radius:7px; font-weight:700; font-size:0.86rem;" />
                  ` : ''}
                  <button type="button" class="code-pill ${itemVal === 'OK' ? 'active-OK' : ''}" data-enf-item="${it.id}" data-val="OK">OK</button>
                  <button type="button" class="code-pill ${itemVal === 'F' ? 'active-warn' : ''}" data-enf-item="${it.id}" data-val="F">FALTA</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <div style="display:flex; justify-content:space-between; margin-top:12px; gap:8px; flex-wrap:wrap;">
          <button type="button" class="btn btn-outline btn-sm" id="btn-enf-prev" ${activeEnfSectionIdx === 0 ? 'disabled style="opacity:0.4"' : ''}>⬅️ Compartimento Anterior</button>
          <button type="button" class="btn btn-outline btn-sm" id="btn-enf-next" ${activeEnfSectionIdx === sections.length - 1 ? 'disabled style="opacity:0.4"' : ''}>Próximo Compartimento ➡️</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span>📝 Observações &amp; Assinatura da Enfermagem</span></div>
        <div class="grid-2">
          <div class="field ${showErr && val.invalidFields.has('obsPagina1') ? 'field-invalid' : ''}" id="enf-field-obs-1">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:4px; flex-wrap:wrap;">
              <label style="margin:0;">OBS – Mochilas (Página 1) *</label>
              <button type="button" class="btn-quick-fill" data-enf-quick-obs="1">✅ Sem alterações</button>
            </div>
            <textarea rows="3" id="enf-obs-1" placeholder="Obrigatório: reposições realizadas, lacres, validade ou 'Sem alterações'...">${escapeHtml(d.obsPagina1)}</textarea>
          </div>
          <div class="field ${showErr && val.invalidFields.has('obsPagina2') ? 'field-invalid' : ''}" id="enf-field-obs-2">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:4px; flex-wrap:wrap;">
              <label style="margin:0;">OBS – Viatura / Gavetas / Armário (Pág. 2) *</label>
              <button type="button" class="btn-quick-fill" data-enf-quick-obs="2">✅ Sem alterações</button>
            </div>
            <textarea rows="3" id="enf-obs-2" placeholder="Obrigatório: observações dos materiais internos da USB ou 'Sem alterações'...">${escapeHtml(d.obsPagina2)}</textarea>
          </div>
        </div>
        <div class="field">
          <label style="${showErr && val.invalidFields.has('sigEnfermagem') ? 'color:#b91c1c;' : ''}">Assinatura e Carimbo Digital na Tela *</label>
          <div class="sig-preview-box ${d.sigEnfermagem ? 'signed' : ''} ${showErr && val.invalidFields.has('sigEnfermagem') ? 'sig-invalid' : ''}" id="enf-sig-box">
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
    bindStepPillsHorizontalScroll(container);

    const saveEnfDraft = () => {
      if (!editingEnfermagemId && currentUser) {
        window.SamuStorage.saveDraft(currentUser.username, 'checklist_enfermagem', enfermagemState);
      }
    };

    const refreshEnfValidationAndCountersInPlace = () => {
      const curDoneAll = sections.reduce((acc, s) => acc + s.items.filter(i => Boolean(String(targetMap[i.id] || '').trim())).length, 0);
      const topCnt = document.getElementById('enf-top-counter');
      if (topCnt) topCnt.textContent = `Total conferido (${isDia ? 'CK DIA' : 'CK NOITE'}): ${curDoneAll} de ${totalAll} materiais`;

      const activePill = container.querySelector(`[data-enf-sec="${activeEnfSectionIdx}"]`);
      if (activePill) {
        const secDone = activeSec.items.filter(it => Boolean(String(targetMap[it.id] || '').trim())).length;
        activePill.textContent = `${activeSec.title} (${secDone}/${activeSec.items.length})`;
      }

      if (!enfermagemValidationActive) return;
      const v = validateEnfermagemChecklist(d);
      const slot = document.getElementById('enf-validation-banner-slot');
      if (v.valid) {
        enfermagemValidationActive = false;
        if (slot) slot.innerHTML = '';
      } else if (slot) {
        slot.innerHTML = renderChecklistValidationBannerHtml(v);
      }

      const fieldPairs = [
        ['data', 'enf-field-data'],
        ['turno', 'enf-field-turno'],
        ['responsavelNome', 'enf-field-nome'],
        ['responsavelCoren', 'enf-field-coren'],
        ['obsPagina1', 'enf-field-obs-1'],
        ['obsPagina2', 'enf-field-obs-2']
      ];
      fieldPairs.forEach(([key, domId]) => {
        const el = document.getElementById(domId);
        if (el) el.classList.toggle('field-invalid', !v.valid && v.invalidFields.has(key));
      });

      sections.forEach((_, idx) => {
        const pill = container.querySelector(`[data-enf-sec="${idx}"]`);
        if (pill) pill.classList.toggle('pill-incomplete', !v.valid && v.incompleteSecIdxs.has(idx));
      });

      activeSec.items.forEach(it => {
        const row = document.getElementById(`enf-item-row-${it.id}`);
        if (row) row.classList.toggle('item-invalid', !v.valid && v.missingItemIds.has(it.id));
      });
    };

    document.getElementById('enf-data').addEventListener('input', e => {
      d.data = e.target.value;
      saveEnfDraft();
      refreshEnfValidationAndCountersInPlace();
    });
    document.getElementById('enf-data').addEventListener('change', () => {
      if (!editingEnfermagemId) {
        applySharedDailyToEnfermagemState(d, { replaceOtherShift: true });
        saveEnfDraft();
        renderEnfermagemView();
      }
    });
    document.getElementById('enf-turno').addEventListener('change', e => {
      syncActiveShiftFieldsInEnfermagem(d);
      d.turno = e.target.value;
      const myName = currentUser ? currentUser.name : '';
      const myCoren = currentUser ? (currentUser.coren || currentUser.councilId || '') : '';
      const mySig = currentUser ? (window.SamuStorage.getSavedSignature(currentUser.username) || '') : '';
      if (d.turno === 'NOITE') {
        d.responsavelNome = d.responsavelNoiteNome || myName;
        d.responsavelCoren = d.responsavelNoiteCoren || myCoren;
        d.obsPagina1 = d.obsNoitePagina1 || '';
        d.obsPagina2 = d.obsNoitePagina2 || '';
        d.sigEnfermagem = d.sigEnfermagemNoite || mySig;
      } else {
        d.responsavelNome = d.responsavelDiaNome || myName;
        d.responsavelCoren = d.responsavelDiaCoren || myCoren;
        d.obsPagina1 = d.obsDiaPagina1 || '';
        d.obsPagina2 = d.obsDiaPagina2 || '';
        d.sigEnfermagem = d.sigEnfermagemDia || mySig;
      }
      syncActiveShiftFieldsInEnfermagem(d);
      if (!editingEnfermagemId) {
        applySharedDailyToEnfermagemState(d, { replaceOtherShift: false });
      }
      saveEnfDraft();
      renderEnfermagemView();
    });
    document.getElementById('enf-nome').addEventListener('input', e => { d.responsavelNome = e.target.value; syncActiveShiftFieldsInEnfermagem(d); saveEnfDraft(); refreshEnfValidationAndCountersInPlace(); });
    document.getElementById('enf-coren').addEventListener('input', e => { d.responsavelCoren = e.target.value; syncActiveShiftFieldsInEnfermagem(d); saveEnfDraft(); refreshEnfValidationAndCountersInPlace(); });
    const obs1Inp = document.getElementById('enf-obs-1');
    const obs2Inp = document.getElementById('enf-obs-2');
    obs1Inp.addEventListener('input', e => { d.obsPagina1 = e.target.value; syncActiveShiftFieldsInEnfermagem(d); saveEnfDraft(); refreshEnfValidationAndCountersInPlace(); });
    obs2Inp.addEventListener('input', e => { d.obsPagina2 = e.target.value; syncActiveShiftFieldsInEnfermagem(d); saveEnfDraft(); refreshEnfValidationAndCountersInPlace(); });

    container.querySelectorAll('[data-enf-quick-obs]').forEach(btn => {
      btn.addEventListener('click', () => {
        const which = btn.dataset.enfQuickObs;
        if (which === '1') {
          const cur = String(d.obsPagina1 || '').trim();
          d.obsPagina1 = cur || 'Sem alterações.';
          obs1Inp.value = d.obsPagina1;
        } else {
          const cur = String(d.obsPagina2 || '').trim();
          d.obsPagina2 = cur || 'Sem alterações.';
          obs2Inp.value = d.obsPagina2;
        }
        syncActiveShiftFieldsInEnfermagem(d);
        saveEnfDraft();
        refreshEnfValidationAndCountersInPlace();
        showToast('Observação preenchida: Sem alterações.');
      });
    });

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
      activeSec.items.forEach(it => {
        if (!it.customInput && !String(targetMap[it.id] || '').trim()) {
          targetMap[it.id] = 'OK';
        }
      });
      saveEnfDraft();
      renderEnfermagemView();
      const pendingCustom = activeSec.items.find(it => it.customInput && !String(targetMap[it.id] || '').trim());
      if (pendingCustom) {
        showToast(`✅ Itens marcados OK! Informe o valor de "${pendingCustom.name}".`);
      } else {
        showToast(`${activeSec.title}: todos os itens marcados OK!`);
      }
    });

    document.getElementById('btn-enf-all-ok').addEventListener('click', () => {
      let pendingCustomSecIdx = -1;
      let pendingCustomName = '';
      sections.forEach((sec, sIdx) => {
        sec.items.forEach(it => {
          if (!it.customInput && !String(targetMap[it.id] || '').trim()) {
            targetMap[it.id] = 'OK';
          } else if (it.customInput && !String(targetMap[it.id] || '').trim() && pendingCustomSecIdx === -1) {
            pendingCustomSecIdx = sIdx;
            pendingCustomName = it.name;
          }
        });
      });
      if (pendingCustomSecIdx >= 0) {
        activeEnfSectionIdx = pendingCustomSecIdx;
      }
      saveEnfDraft();
      renderEnfermagemView();
      if (pendingCustomName) {
        showToast(`✅ Materiais marcados OK! Informe o valor de "${pendingCustomName}".`);
      } else {
        showToast('Todas as 10 mochilas/compartimentos marcados como OK!');
      }
    });

    document.getElementById('btn-reset-enf').addEventListener('click', async () => {
      if (!(await samuConfirm('Limpar os dados deste Check List de Enfermagem?'))) return;
      editingEnfermagemId = null;
      enfermagemValidationActive = false;
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
        inp.style.borderColor = String(inp.value || '').trim() ? 'var(--border)' : '#dc2626';
        saveEnfDraft();
        refreshEnfValidationAndCountersInPlace();
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
        syncActiveShiftFieldsInEnfermagem(d);
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
      syncActiveShiftFieldsInEnfermagem(d);
      if (!editingEnfermagemId) {
        applySharedDailyToEnfermagemState(d, { replaceOtherShift: false });
      }
      await openPdfPreviewModal(buildEnfRecord(editingEnfermagemId || uid('ckenf')));
    });

    document.getElementById('btn-save-send-enf').addEventListener('click', async () => {
      const checkVal = validateEnfermagemChecklist(d);
      if (!checkVal.valid) {
        enfermagemValidationActive = true;
        if (checkVal.firstMissingSecIdx >= 0) {
          activeEnfSectionIdx = checkVal.firstMissingSecIdx;
        }
        renderEnfermagemView();
        scrollToMissingChecklistField(checkVal.firstMissingDomId);
        await samuAlert(
          '⚠️ Preencha todos os campos do Check List de Enfermagem antes de enviar:\n\n• ' +
          checkVal.errors.join('\n• ')
        );
        return;
      }

      const btn = document.getElementById('btn-save-send-enf');
      btn.disabled = true;
      btn.textContent = 'Gerando PDF e Salvando...';
      try {
        if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
          await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: false }).catch(() => {});
        }
        syncActiveShiftFieldsInEnfermagem(d);
        applySharedDailyToEnfermagemState(d, { replaceOtherShift: false });
        if (window.SamuStorage.saveSharedDailyChecklist) {
          await window.SamuStorage.saveSharedDailyChecklist('enfermagem', d, currentUser);
        }
        const recId = editingEnfermagemId || uid('ckenf');
        const existing = editingEnfermagemId ? await window.SamuStorage.getRecordById(editingEnfermagemId) : null;
        const record = buildEnfRecord(recId, existing);
        const generated = await window.SamuPDF.generatePdfForRecord(record);
        await window.SamuStorage.saveRecordLocal(record);
        const upRes = await window.SamuStorage.uploadRecordToDrive(record, generated.base64);
        await window.SamuStorage.clearDraft(currentUser.username, 'checklist_enfermagem');

        editingEnfermagemId = null;
        enfermagemValidationActive = false;
        enfermagemState = createEmptyEnfermagem();
        await refreshDraftCount();
        await refreshSyncBadge();
        await openPdfPreviewModal(record, generated, upRes);
        renderEnfermagemView();
      } catch (err) {
        samuAlert('Erro ao salvar Check List de Enfermagem: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 Salvar e Enviar PDF ao Google Drive';
      }
    });

    const btnQuickEnEnf = document.getElementById('btn-adm-quick-enable-enf');
    if (btnQuickEnEnf) {
      btnQuickEnEnf.addEventListener('click', async () => {
        btnQuickEnEnf.disabled = true;
        await window.SamuStorage.saveChecklistModulesConfig({ enfermagemEnabled: true }, currentUser && currentUser.username);
        renderBottomNav();
        await refreshDraftCount();
        await refreshSyncBadge();
        renderEnfermagemView();
        showToast('✅ Check List da Enfermagem ATIVADO para os funcionários!');
      });
    }
  }

  /* ==========================================================================
   * ABA 4: HISTÓRICO COM BUSCA DE PACIENTES & CONTROLE POR PERFIL
   * ========================================================================== */
  async function renderHistoricoView() {
    const container = document.getElementById('main-view');
    const isAdmin = window.SamuStorage.isUserAdmin(currentUser);
    const rawVisibleRecords = await window.SamuStorage.getVisibleRecords(currentUser);
    const visibleRecords = rawVisibleRecords.filter(r => isRecordAllowedForCurrentUser(r));
    const allowCondHist = isAdmin || (currentUser && currentUser.role === 'condutor' && isChecklistAllowed('condutor', currentUser));
    const allowEnfHist = isAdmin || (currentUser && currentUser.role === 'enfermagem' && isChecklistAllowed('enfermagem', currentUser));
    if (historyTypeFilter === 'checklist_condutor' && !allowCondHist) historyTypeFilter = 'all';
    if (historyTypeFilter === 'checklist_enfermagem' && !allowEnfHist) historyTypeFilter = 'all';

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
    if (allowCondHist) {
      typeFilterOptions.push({ id: 'checklist_condutor', label: 'Check List Condutor' });
    }
    if (allowEnfHist) {
      typeFilterOptions.push({ id: 'checklist_enfermagem', label: 'Check List Enfermagem' });
    }

    const nonAdmHasAnyCk = allowCondHist || allowEnfHist;

    container.innerHTML = `
      <div class="card" style="padding:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
          <div>
            <strong style="font-size:1.05rem;">${isAdmin ? '🔎 Histórico Geral da Central (Adm)' : '🔎 Meu Histórico de Registros'}</strong>
            <div style="font-size:0.79rem; color:var(--muted);">
              ${isAdmin
                ? 'Acesso total: pesquisando em todas as fichas e checklists de condutores e técnicos.'
                : (nonAdmHasAnyCk
                    ? 'Privacidade ativa: exibindo apenas as fichas e checklists feitos no seu login.'
                    : 'Privacidade ativa: exibindo apenas as fichas feitas no seu login.')}
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

    container.querySelectorAll('[data-h-print-base]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const rec = await window.SamuStorage.getRecordById(btn.dataset.hPrintBase);
        if (!rec) return;
        const ok = await sendRecordToBasePrinter(rec, null, btn);
        if (ok && activeTab === 'historico') {
          renderHistoricoView();
        }
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
        if (!rec || !isRecordAllowedForCurrentUser(rec)) return;
        if (rec.type === 'ficha') {
          fichaState = normalizeFichaData(rec.data);
          if (activeCrew) {
            applyCrewToFichaState(fichaState, activeCrew, false);
          }
          editingFichaId = rec.id;
          fichaStep = 1;
          resetFichaSyncTracking(fichaState, 'sf_rec_' + rec.id, {}, true);
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
        upgradeExistingSignaturesToBlueInk();
        window.scrollTo(0, 0);
      });
    });

    container.querySelectorAll('[data-h-del-admin]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await deleteRecordCompletelyAsAdmin(btn.dataset.hDelAdmin, btn);
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

  async function deleteRecordCompletelyAsAdmin(recordId, triggerBtn) {
    if (!currentUser || !window.SamuStorage.isUserAdmin(currentUser)) {
      samuAlert('Apenas usuários ADM podem apagar registros definitivamente.');
      return false;
    }
    const cleanId = String(recordId || '').trim();
    if (!cleanId) return false;

    const rec = (await window.SamuStorage.getRecordById(cleanId)) ||
      (previewCurrentRecord && previewCurrentRecord.id === cleanId ? previewCurrentRecord : null);

    let typeLabel = 'Ficha de Atendimento';
    let titleLabel = (rec && rec.patientName) || 'Paciente não identificado';
    if (rec && rec.type === 'checklist_condutor') {
      typeLabel = 'Check List Condutor';
      titleLabel = rec.vehicle || 'Viatura USB';
    } else if (rec && rec.type === 'checklist_enfermagem') {
      typeLabel = 'Check List Enfermagem';
      titleLabel = `Checagem Diária USB (${rec.shift || 'Plantão'})`;
    }
    const rawDate = (rec && rec.date) ? String(rec.date) : '';
    const dParts = rawDate.split('-');
    const dateBR = dParts.length === 3 ? `${dParts[2]}/${dParts[1]}/${dParts[0]}` : (rawDate || 'Sem data');
    const isDraft = Boolean(rec && rec.syncStatus === 'draft');

    const confirmMsg = isDraft
      ? `Excluir PERMANENTEMENTE este rascunho de ${typeLabel}?\n\n• ${titleLabel} (${dateBR})\n\nEle será apagado de todos os celulares da equipe.`
      : `Excluir PERMANENTEMENTE este registro (${typeLabel})?\n\n• ${titleLabel} (${dateBR})\n\nEsta ação apagará a ficha/checklist de TODOS os celulares do aplicativo, removerá da Planilha de Controle e excluirá o PDF do Google Drive.`;

    if (!(await samuConfirm(confirmMsg))) return false;

    const origText = triggerBtn ? triggerBtn.textContent : '';
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = '🗑️ Excluindo...';
    }
    try {
      const res = await window.SamuStorage.adminDeleteRecordCompletely(cleanId, currentUser);

      if (editingFichaId === cleanId) {
        editingFichaId = null;
        fichaState = createEmptyFicha();
        resetFichaSyncTracking(fichaState, uid('sf'), {}, false);
        await window.SamuStorage.clearDraft(currentUser.username, 'ficha');
      }
      if (editingCondutorId === cleanId) {
        editingCondutorId = null;
        condutorState = createEmptyCondutor();
        await window.SamuStorage.clearDraft(currentUser.username, 'condutor');
      }
      if (editingEnfermagemId === cleanId) {
        editingEnfermagemId = null;
        enfermagemState = createEmptyEnfermagem();
        await window.SamuStorage.clearDraft(currentUser.username, 'enfermagem');
      }

      if (previewCurrentRecord && previewCurrentRecord.id === cleanId) {
        const prevModal = document.getElementById('pdf-preview-modal');
        if (prevModal) prevModal.classList.add('hidden');
        previewCurrentRecord = null;
      }

      await refreshDraftCount();
      await refreshSyncBadge();
      renderActiveView();

      showToast(res.driveDeleted
        ? `🗑️ ${typeLabel} excluído completamente do Aplicativo e do Google Drive!`
        : `🗑️ ${typeLabel} excluído do Aplicativo! (O PDF no Google Drive será removido ao sincronizar)`);
      return true;
    } catch (err) {
      samuAlert('Erro ao excluir registro: ' + (err.message || err));
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = origText;
      }
      return false;
    }
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

    const printJob = (!isDraft && window.SamuStorage.getRecordPrintStatus)
      ? window.SamuStorage.getRecordPrintStatus(rec.id)
      : null;
    let printBadgeHtml = '';
    if (!isDraft) {
      if (printJob && printJob.status === 'printed') {
        printBadgeHtml = `<span class="type-badge" style="background:#dbeafe; color:#1e40af;" title="Impresso na Base${printJob.printerName ? ' (' + escapeHtml(printJob.printerName) + ')' : ''}">🖨️ Impresso na Base</span>`;
      } else if ((printJob && printJob.status === 'pending') || rec.pendingAutoPrint) {
        printBadgeHtml = `<span class="type-badge" style="background:#fef3c7; color:#92400e;">⏳ Fila Impressora Base</span>`;
      } else if (printJob && printJob.status === 'error') {
        printBadgeHtml = `<span class="type-badge" style="background:#fee2e2; color:#991b1b;" title="${escapeHtml(printJob.errorMsg || 'Erro ao imprimir')}">⚠️ Erro Impressão Base</span>`;
      }
    }
    const printBtnLabel = (printJob && printJob.status === 'printed') ? '🖨️ Reimprimir na Base' : '🖨️ Imprimir na Base';

    return `
      <div class="history-card">
        <div class="history-top">
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <span class="type-badge ${badgeClass}">${badgeText}</span>
            ${riskBadge}
            ${printBadgeHtml}
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
          <button type="button" class="btn btn-primary btn-sm" data-h-pdf="${escapeHtml(rec.id)}">📄 Gerar / Ver PDF</button>
          ${!isDraft ? `<button type="button" class="btn btn-outline btn-sm" style="border-color:#1d4ed8; color:#1d4ed8;" data-h-print-base="${escapeHtml(rec.id)}">${printBtnLabel}</button>` : ''}
          ${rec.type === 'ficha' ? `<button type="button" class="btn btn-whatsapp btn-sm" data-h-reg="${escapeHtml(rec.id)}">📲 Cabeçalho Regulação</button>` : ''}
          ${rec.driveUrl ? `<a href="${escapeHtml(rec.driveUrl)}" target="_blank" rel="noopener" class="btn btn-success btn-sm" style="text-decoration:none;">☁️ Ver no Google Drive</a>` : ''}
          ${isAdmin
            ? `<button type="button" class="btn btn-danger-outline btn-sm" data-h-del-admin="${escapeHtml(rec.id)}">${isDraft ? '🗑️ Excluir Rascunho' : '🗑️ Excluir do App e Drive'}</button>`
            : (isDraft ? `<button type="button" class="btn btn-secondary btn-sm" data-h-del-draft="${escapeHtml(rec.id)}">🗑️ Excluir</button>` : '')}
        </div>
      </div>
    `;
  }

  /* ==========================================================================
   * ABA EXCLUSIVA ADM: APROVAÇÃO DE NOVOS CADASTROS (OFFLINE + GITHUB)
   * ========================================================================== */
  function buildProfileSelectOptionsHtml(selectedVal, selfAdminOnly) {
    const cur = String(selectedVal || 'tecnico');
    const opts = [
      { value: 'tecnico', label: '🩺 Téc. de Enfermagem', admin: false },
      { value: 'enfermeiro', label: '👩‍⚕️ Enfermeiro(a)', admin: false },
      { value: 'condutor', label: '🚑 Condutor Socorrista', admin: false },
      { value: 'condutor_admin', label: '🚑🔑 Condutor Socorrista + ADM (Híbrido)', admin: true },
      { value: 'enfermeiro_admin', label: '👩‍⚕️🔑 Enfermeiro(a) + ADM (Híbrido)', admin: true },
      { value: 'tecnico_admin', label: '🩺🔑 Téc. de Enfermagem + ADM (Híbrido)', admin: true },
      { value: 'admin', label: '🔑 Somente Administrador / Coordenação (ADM)', admin: true }
    ];
    return opts
      .filter(o => !selfAdminOnly || o.admin)
      .map(o => `<option value="${o.value}" ${cur === o.value ? 'selected' : ''}>${o.label}</option>`)
      .join('');
  }

  function profileChoiceUsesCoren(choiceVal) {
    const c = String(choiceVal || '');
    return c !== 'condutor' && c !== 'condutor_admin';
  }

  async function deleteUserAccountWithSync(uname) {
    const cleanUname = String(uname || '').trim().toLowerCase();
    if (!cleanUname) return false;
    if (currentUser && cleanUname === currentUser.username.toLowerCase()) {
      samuAlert('Você está logado neste usuário agora. Entre com outro login de ADM caso queira excluir esta conta.');
      return false;
    }
    const allUsers = window.SamuStorage.getLocalUsers();
    const target = allUsers.find(u => u.username.toLowerCase() === cleanUname);
    if (target && window.SamuStorage.isUserAdmin(target)) {
      const otherAdmins = allUsers.filter(u =>
        u.username.toLowerCase() !== cleanUname &&
        u.active !== false &&
        u.status !== 'pending' &&
        window.SamuStorage.isUserAdmin(u)
      );
      if (!otherAdmins.length) {
        samuAlert('Não é possível excluir o único login com permissão de ADM do sistema. Crie ou promova outro ADM primeiro.');
        return false;
      }
    }

    const labelName = target ? `"${target.name}" (login: ${target.username})` : `"${cleanUname}"`;
    if (!(await samuConfirm(`Excluir permanentemente o login ${labelName} da Base Interna e do Google Drive?`))) {
      return false;
    }

    window.SamuStorage.deleteLocalUser(cleanUname);
    if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
      try { await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: true }); } catch (eGh) {}
    }
    const curSettings = window.SamuStorage.getSettings();
    if (curSettings.scriptUrl && navigator.onLine) {
      try {
        await window.SamuStorage.apiPost({
          action: 'deleteUser',
          authUser: currentUser.username,
          authPass: currentUser.password,
          authName: currentUser.name,
          authRole: window.SamuStorage.getUserProfileChoice(currentUser),
          username: cleanUname
        });
      } catch (e) {}
    }
    renderBottomNav();
    await refreshSyncBadge();
    showToast(`🗑️ Login "${cleanUname}" excluído com sucesso!`);
    return true;
  }

  async function renderAprovacoesView(skipAutoPull) {
    if (!currentUser || !window.SamuStorage.isUserAdmin(currentUser)) return;
    const container = document.getElementById('main-view');
    const hasGh = window.SamuStorage.hasGitHubConfigured();
    const ghMeta = window.SamuStorage.getGitHubMeta();

    // Consulta automaticamente a base do GitHub quando tiver internet
    if (!skipAutoPull && navigator.onLine && hasGh) {
      window.SamuStorage.syncInternalDbWithGitHub().then(async () => {
        if (currentUser && window.SamuStorage.isUserAdmin(currentUser) && activeTab === 'aprovacoes') {
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
          Quando um Técnico de Enfermagem, Enfermeiro(a) (Login, Senha, COREN e CPF) ou Condutor (Login, Senha e CPF) cria cadastro na tela inicial, a solicitação aparece aqui para você aprovar. Funciona <strong>100% offline pela Base Interna</strong> e sincroniza automaticamente em tempo real pelo <strong>Google Drive</strong> (sem precisar de token!).
        </p>
        <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px;">
          <div style="font-size:0.8rem;">
            ${hasGh
              ? `☁️ <strong>Google Drive ativo</strong> • Última sincronização: <span>${escapeHtml(lastSyncText)}</span>`
              : `🗄️ <strong>Base Interna Offline ativa</strong> • <span style="color:var(--muted);">Configure a conexão na aba ⚙️ Base/Drive</span>`}
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="btn btn-primary btn-sm" id="btn-aprov-pull-gh">🔄 Sincronizar Agora</button>
            <button type="button" class="btn btn-outline btn-sm" id="btn-aprov-open-gh-cfg">⚙️ Base / Drive</button>
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
          const subRole = window.SamuStorage.getUserSubRole(u);
          const roleLabel = window.SamuStorage.getUserRoleLabel(u);
          const roleIcon = subRole === 'enfermeiro' ? '👩‍⚕️' : (isEnf ? '🩺' : '🚑');
          const reqDate = u.requestedAt ? new Date(u.requestedAt).toLocaleString('pt-BR') : 'Agora';
          return `
            <div class="approval-card">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
                <div>
                  <span class="type-badge ${isEnf ? 'type-enfermagem' : 'type-condutor'}">
                    ${roleIcon} ${escapeHtml(roleLabel)}
                  </span>
                  <div style="font-size:1.02rem; font-weight:800; margin-top:4px; color:#0f172a;">${escapeHtml(u.name)}</div>
                </div>
                <small style="color:#92400e; font-weight:700;">📅 ${escapeHtml(reqDate)}</small>
              </div>

              <div style="font-size:0.84rem; color:#334155; margin-bottom:8px; line-height:1.5;">
                👤 Login solicitado: <strong><code>${escapeHtml(u.username)}</code></strong>
                • 🔑 Senha criada: <code class="pw-pill">${escapeHtml(u.password || '(sem senha)')}</code>
                • 🪪 CPF: <strong>${escapeHtml(u.cpf || 'Não informado')}</strong>
                ${isEnf ? `<br>${roleIcon} COREN informado: <strong>${escapeHtml(u.coren || u.councilId || 'Não informado')}</strong>` : ''}
              </div>

              <div class="grid-2" style="margin-bottom:10px;">
                <div class="field" style="margin-bottom:0;">
                  <label>Cargo / Nível de Acesso ao Aprovar (suporta Híbrido)</label>
                  <select data-aprov-role="${escapeHtml(u.username)}">
                    ${buildProfileSelectOptionsHtml(window.SamuStorage.getUserProfileChoice(u), false)}
                  </select>
                </div>
                <div class="field" data-aprov-coren-wrap="${escapeHtml(u.username)}" style="margin-bottom:0; ${!profileChoiceUsesCoren(window.SamuStorage.getUserProfileChoice(u)) ? 'display:none;' : ''}">
                  <label>Confirmar / Ajustar COREN</label>
                  <input type="text" data-aprov-coren="${escapeHtml(u.username)}" value="${escapeHtml(u.coren || u.councilId || '')}" placeholder="Ex: COREN-SP 542.810-TE" />
                </div>
              </div>

              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button type="button" class="btn btn-success btn-sm" data-approve-user="${escapeHtml(u.username)}">✅ Aprovar Cadastro</button>
                <button type="button" class="btn btn-secondary btn-sm" data-reject-user="${escapeHtml(u.username)}">❌ Recusar / Excluir</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="card">
        <div class="card-title"><span>👥 Equipe Já Aprovada – Alterar Cargo (Híbrido) ou Excluir Login (${approvedUsers.length})</span></div>
        <p style="margin:0 0 10px; font-size:0.8rem; color:var(--muted);">
          Altere para cargos híbridos (ex.: <strong>🚑🔑 Condutor + ADM</strong> ou <strong>👩‍⚕️🔑 Enfermeiro(a) + ADM</strong>), promova integrantes ou exclua logins antigos:
        </p>
        <div>
          ${approvedUsers.map(u => {
            const curSelVal = window.SamuStorage.getUserProfileChoice(u);
            const isSelf = u.username.toLowerCase() === currentUser.username.toLowerCase();
            const roleIcon = window.SamuStorage.getUserRoleIcon(u);
            const roleBadge = `${roleIcon} ${window.SamuStorage.getUserRoleLabel(u)}`;
            const corenTxt = u.coren || u.councilId || '';
            const showCorenInp = curSelVal === 'tecnico' || curSelVal === 'enfermeiro' || curSelVal === 'tecnico_admin' || curSelVal === 'enfermeiro_admin';
            return `
              <div class="check-item-row" style="flex-wrap:wrap; gap:8px;">
                <div class="check-item-info" style="min-width:190px;">
                  <strong>${escapeHtml(u.name)}</strong> <small style="color:var(--muted);">(${escapeHtml(roleBadge)})</small>
                  ${isSelf ? `<span class="type-badge" style="background:#dcfce7; color:#14532d; margin-left:4px;">Você</span>` : ''}
                  <br>
                  <small style="color:var(--muted);">
                    Login: <code>${escapeHtml(u.username)}</code>
                    • 🔑 Senha: <code class="pw-pill">${escapeHtml(u.password || '****')}</code>
                    ${u.cpf ? ` • CPF: ${escapeHtml(u.cpf)}` : ''}
                    ${corenTxt ? ` • <strong>${escapeHtml(corenTxt)}</strong>` : ''}
                  </small>
                </div>
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; flex:1; justify-content:flex-end;">
                  <select data-promote-role="${escapeHtml(u.username)}" style="flex:1; min-width:185px; max-width:270px; padding:8px 10px; border:1.5px solid var(--border); border-radius:8px; font-size:0.82rem; font-weight:700; background:#fff;">
                    ${buildProfileSelectOptionsHtml(curSelVal, isSelf)}
                  </select>
                  <input type="text" data-promote-coren="${escapeHtml(u.username)}" value="${escapeHtml(corenTxt)}" placeholder="COREN-SP..." style="width:155px; padding:8px 10px; border:1.5px solid var(--border); border-radius:8px; font-size:0.82rem; ${showCorenInp ? '' : 'display:none;'}" />
                  <button type="button" class="btn btn-primary btn-sm" data-promote-save="${escapeHtml(u.username)}">⬆️ Salvar Cargo</button>
                  <button type="button" class="btn btn-outline btn-sm" data-aprov-pw-u="${escapeHtml(u.username)}">🔑 Trocar Senha</button>
                  ${!isSelf ? `<button type="button" class="btn btn-secondary btn-sm" data-aprov-del-u="${escapeHtml(u.username)}">🗑️ Excluir</button>` : ''}
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
          showToast('Configure a URL do Google Drive abaixo para ativar a sincronização online.');
          return;
        }
        if (!navigator.onLine) {
          showToast('📴 Sem internet agora — exibindo cadastros da Base Interna Offline.');
          return;
        }
        btnPullGh.disabled = true;
        btnPullGh.textContent = 'Sincronizando...';
        try {
          await window.SamuStorage.syncInternalDbWithGitHub();
          renderBottomNav();
          await refreshSyncBadge();
          renderAprovacoesView(true);
          showToast('✅ Base de dados sincronizada com o Google Drive!');
        } catch (err) {
          samuAlert('Erro ao sincronizar com o Google Drive: ' + err.message);
        } finally {
          btnPullGh.disabled = false;
          btnPullGh.textContent = '🔄 Sincronizar Agora';
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

    container.querySelectorAll('[data-aprov-role]').forEach(sel => {
      sel.addEventListener('change', () => {
        const uname = sel.dataset.aprovRole;
        const escUname = CSS.escape ? CSS.escape(uname) : uname;
        const wrap = container.querySelector(`[data-aprov-coren-wrap="${escUname}"]`);
        if (wrap) wrap.style.display = profileChoiceUsesCoren(sel.value) ? '' : 'none';
      });
    });

    container.querySelectorAll('[data-promote-role]').forEach(sel => {
      sel.addEventListener('change', () => {
        const uname = sel.dataset.promoteRole;
        const escUname = CSS.escape ? CSS.escape(uname) : uname;
        const cInp = container.querySelector(`[data-promote-coren="${escUname}"]`);
        if (cInp) {
          const isNurs = sel.value === 'tecnico' || sel.value === 'enfermeiro' || sel.value === 'tecnico_admin' || sel.value === 'enfermeiro_admin';
          cInp.style.display = isNurs ? '' : 'none';
        }
      });
    });

    const mapRoleChoiceToFields = (choiceVal) => window.SamuStorage.mapProfileChoiceToFields(choiceVal);

    container.querySelectorAll('[data-approve-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uname = btn.dataset.approveUser;
        const escUname = CSS.escape ? CSS.escape(uname) : uname;
        const corenInput = container.querySelector(`[data-aprov-coren="${escUname}"]`);
        const roleSelect = container.querySelector(`[data-aprov-role="${escUname}"]`);
        const overrides = {};
        if (roleSelect) {
          Object.assign(overrides, mapRoleChoiceToFields(roleSelect.value));
        }
        if (overrides.role === 'condutor') {
          overrides.coren = '';
          overrides.councilId = '';
        } else if (corenInput) {
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
          const finalLbl = window.SamuStorage.getUserRoleLabel(res.user);
          showToast(res.githubSynced
            ? `✅ "${uname}" aprovado como ${finalLbl} na Base Interna e no Google Drive!`
            : `✅ "${uname}" aprovado como ${finalLbl} na Base Interna! (Sincronizará c/ Google Drive ao conectar)`);
        } catch (err) {
          samuAlert('Erro ao aprovar cadastro: ' + err.message);
          btn.disabled = false;
          btn.textContent = '✅ Aprovar Cadastro';
        }
      });
    });

    container.querySelectorAll('[data-promote-save]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uname = btn.dataset.promoteSave;
        const escUname = CSS.escape ? CSS.escape(uname) : uname;
        const sel = container.querySelector(`[data-promote-role="${escUname}"]`);
        const corenInp = container.querySelector(`[data-promote-coren="${escUname}"]`);
        if (!sel) return;
        const target = approvedUsers.find(u => u.username.toLowerCase() === uname.toLowerCase());
        if (!target) return;

        const mapped = mapRoleChoiceToFields(sel.value);
        const curSelVal = window.SamuStorage.getUserProfileChoice(target);
        const nextCoren = mapped.role === 'condutor'
          ? ''
          : ((corenInp ? corenInp.value.trim() : '') || target.coren || target.councilId || '');

        if (sel.value === curSelVal && nextCoren === String(target.coren || target.councilId || '')) {
          showToast(`"${target.name}" já está com este cargo.`);
          return;
        }

        const newRolePreview = window.SamuStorage.getUserRoleLabel(Object.assign({}, target, mapped));
        if (!(await samuConfirm(`Alterar o cargo de "${target.name}" (${target.username}) para "${newRolePreview}"?`))) {
          sel.value = curSelVal;
          return;
        }

        const updatedUser = Object.assign({}, target, mapped, {
          coren: mapped.role === 'enfermagem' ? nextCoren : '',
          councilId: mapped.role === 'condutor' ? '' : nextCoren,
          updatedAt: new Date().toISOString()
        });
        btn.disabled = true;
        btn.textContent = 'Salvando...';
        try {
          window.SamuStorage.upsertLocalUser(updatedUser);
          if (currentUser && target.username.toLowerCase() === currentUser.username.toLowerCase()) {
            const refreshedSelf = window.SamuStorage.getLocalUsers().find(x => x.username.toLowerCase() === currentUser.username.toLowerCase());
            if (refreshedSelf) {
              currentUser = Object.assign({}, currentUser, {
                role: refreshedSelf.role,
                subRole: window.SamuStorage.getUserSubRole(refreshedSelf),
                isAdmin: window.SamuStorage.isUserAdmin(refreshedSelf),
                coren: refreshedSelf.coren || refreshedSelf.councilId || '',
                councilId: refreshedSelf.coren || refreshedSelf.councilId || ''
              });
              window.SamuStorage.setSession(currentUser);
              updateTopbarUserHeader();
            }
          }
          let ghSynced = false;
          if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
            try {
              const ghRes = await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: true });
              ghSynced = Boolean(ghRes && ghRes.pushed);
            } catch (eGh) {}
          }
          const curSettings = window.SamuStorage.getSettings();
          if (curSettings.scriptUrl && navigator.onLine) {
            try {
              await window.SamuStorage.apiPost({
                action: 'saveUser',
                authUser: currentUser.username,
                authPass: currentUser.password,
                authName: currentUser.name,
                authRole: window.SamuStorage.getUserProfileChoice(currentUser),
                userData: Object.assign({}, updatedUser, { role: window.SamuStorage.getUserProfileChoice(updatedUser) })
              });
            } catch (eGs) {}
          }
          renderBottomNav();
          await refreshSyncBadge();
          renderAprovacoesView(true);
          showToast(ghSynced
            ? `✅ Cargo de "${target.name}" atualizado para ${newRolePreview} (Base Interna + Google Drive)!`
            : `✅ Cargo de "${target.name}" atualizado para ${newRolePreview}!`);
        } catch (err) {
          samuAlert('Erro ao alterar cargo: ' + err.message);
          btn.disabled = false;
          btn.textContent = '⬆️ Salvar Cargo';
        }
      });
    });

    container.querySelectorAll('[data-aprov-pw-u]').forEach(btn => {
      btn.addEventListener('click', () => {
        openAdminResetPasswordModal(btn.dataset.aprovPwU, () => renderAprovacoesView(true));
      });
    });

    container.querySelectorAll('[data-aprov-del-u]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = await deleteUserAccountWithSync(btn.dataset.aprovDelU);
        if (ok) renderAprovacoesView(true);
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
  async function renderAdminView(skipInitialPull) {
    if (!currentUser || !window.SamuStorage.isUserAdmin(currentUser)) return;
    const container = document.getElementById('main-view');
    const settings = window.SamuStorage.getSettings();

    // Tenta buscar usuários atualizados do GitHub / Google Apps Script se conectado
    if (!skipInitialPull) {
      if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
        try {
          await window.SamuStorage.syncInternalDbWithGitHub();
        } catch (e) {}
      } else if (settings.scriptUrl && navigator.onLine) {
        try {
          const res = await window.SamuStorage.apiPost({
            action: 'listUsers',
            authUser: currentUser.username,
            authPass: currentUser.password,
            authName: currentUser.name,
            authRole: window.SamuStorage.getUserProfileChoice(currentUser)
          });
          if (res && res.ok && Array.isArray(res.users)) {
            window.SamuStorage.setLocalUsers(res.users);
          }
        } catch (e) {}
      }
    }

    const allUsers = window.SamuStorage.getLocalUsers();
    const pendingUsers = window.SamuStorage.getPendingUsers();
    const users = allUsers.filter(u => u.status !== 'pending');
    const receiversList = window.SamuStorage.getHospitalReceivers();
    const medicosList = window.SamuStorage.getMedicosReguladores ? window.SamuStorage.getMedicosReguladores() : [];
    const patientsList = window.SamuStorage.getInternalPatientsList ? window.SamuStorage.getInternalPatientsList() : [];
    const receiversCount = receiversList.length;
    const medicosRegCount = medicosList.length;
    const patientsCount = patientsList.length;
    const ghMeta = window.SamuStorage.getGitHubMeta();
    const modCfg = getChecklistModulesCfg();
    const printCfg = window.SamuStorage.getRemotePrintConfig
      ? window.SamuStorage.getRemotePrintConfig()
      : { autoPrintFichas: true, autoPrintChecklists: true, duplexMode: 'duplex', copies: 1 };
    const printAgent = window.SamuStorage.getRemotePrintAgentStatus
      ? window.SamuStorage.getRemotePrintAgentStatus()
      : { configured: false, isOnline: false };
    const printQueue = window.SamuStorage.getRemotePrintQueue
      ? window.SamuStorage.getRemotePrintQueue().slice(0, 12)
      : [];

    const buildPrintAgentBannerHtml = () => {
      if (printAgent.isOnline) {
        const dupTag = printAgent.canDuplex ? 'Frente e Verso Ativo' : 'Apenas Frente';
        return `
          <div style="background:#dcfce7; border:1.5px solid #86efac; color:#14532d; border-radius:10px; padding:10px 12px; font-size:0.82rem; font-weight:700; margin-bottom:12px;">
            🟢 <strong>PC da Base Conectado:</strong> ${escapeHtml(printAgent.pcName)} • <strong>Impressora:</strong> ${escapeHtml(printAgent.printerName || 'Padrão do Windows')} (${dupTag})
            <br><span style="font-weight:600; font-size:0.78rem;">Impressos hoje na Base: <strong>${printAgent.printedCountToday}</strong>${printAgent.lastPrintedTitle ? ` • Último: ${escapeHtml(printAgent.lastPrintedTitle)}` : ''}</span>
          </div>
        `;
      }
      if (printAgent.configured) {
        const lastContact = printAgent.updatedAt ? new Date(printAgent.updatedAt).toLocaleString('pt-BR') : '-';
        const pausedNote = printAgent.status === 'paused' ? ' (Fila pausada localmente no PC da Base)' : '';
        return `
          <div style="background:#fef3c7; border:1.5px solid #fcd34d; color:#92400e; border-radius:10px; padding:10px 12px; font-size:0.81rem; font-weight:700; margin-bottom:12px;">
            🟠 <strong>Servidor do PC da Base sem resposta recente${pausedNote}:</strong> ${escapeHtml(printAgent.pcName)} (${escapeHtml(printAgent.printerName || 'Impressora')}) • Último sinal: ${escapeHtml(lastContact)}
            <br><span style="font-weight:600; font-size:0.77rem;">Os PDFs enviados pelos celulares ficam guardados na fila da nuvem e imprimem sozinhos assim que o PC da Base ligar!</span>
          </div>
        `;
      }
      return `
        <div style="background:#eff6ff; border:1.5px solid #bfdbfe; color:#1e3a8a; border-radius:10px; padding:10px 12px; font-size:0.81rem; font-weight:700; margin-bottom:12px;">
          🔵 <strong>Como ativar no PC da Base (1 única vez):</strong> execute o arquivo <code>INSTALAR_IMPRESSORA_BASE_SAMU.bat</code> no computador Windows ligado na impressora da Base SAMU. Ele inicia sozinho com o Windows e já puxa todas as impressões enviadas pelo 4G/Wi-Fi!
        </div>
      `;
    };

    const buildPrintQueueListHtml = () => {
      if (!printQueue.length) {
        return `<div style="padding:12px; text-align:center; color:var(--muted); font-size:0.81rem;">Nenhuma impressão recente na fila da Base ainda.</div>`;
      }
      return printQueue.map(j => {
        let badge = `<span class="type-badge" style="background:#fef3c7; color:#92400e;">⏳ Aguardando Base</span>`;
        if (j.status === 'printed') {
          const hm = j.printedAt ? new Date(j.printedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
          badge = `<span class="type-badge" style="background:#dcfce7; color:#14532d;">✅ Impresso${hm ? ' às ' + hm : ''}</span>`;
        } else if (j.status === 'error') {
          badge = `<span class="type-badge" style="background:#fee2e2; color:#991b1b;">⚠️ Falha</span>`;
        } else if (j.status === 'cancelled') {
          badge = `<span class="type-badge" style="background:#e2e8f0; color:#475569;">🚫 Cancelado</span>`;
        }
        const whenStr = j.createdAt ? new Date(j.createdAt).toLocaleString('pt-BR') : (j.date || '');
        const whoStr = j.requestedByName || j.requestedBy || '';
        return `
          <div class="check-item-row" style="flex-wrap:wrap; gap:8px; padding:7px 4px;">
            <div class="check-item-info">
              ${badge}
              <strong style="margin-left:4px;">${escapeHtml(j.title || 'Documento SAMU')}</strong>
              <br>
              <small style="color:var(--muted);">
                ${escapeHtml(whenStr)}${whoStr ? ` • Por: ${escapeHtml(whoStr)}` : ''}
                ${j.printerName ? ` • Impressora: ${escapeHtml(j.printerName)}` : ''}
                ${j.duplexMode === 'simplex' ? ' • Folhas Separadas' : ' • Frente e Verso'}
                ${j.errorMsg ? `<br><span style="color:#b91c1c; font-weight:700;">Motivo: ${escapeHtml(j.errorMsg)}</span>` : ''}
              </small>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              ${j.status !== 'pending' ? `<button type="button" class="btn btn-outline btn-sm" data-pjob-retry="${escapeHtml(j.jobId)}">🔄 Reimprimir</button>` : ''}
              ${j.status === 'pending' ? `<button type="button" class="btn btn-secondary btn-sm" data-pjob-cancel="${escapeHtml(j.jobId)}">✖ Cancelar</button>` : ''}
            </div>
          </div>
        `;
      }).join('');
    };

    const buildCatalogListHtml = () => {
      const q = normStr(adminCatalogSearch.trim());
      const qDigits = adminCatalogSearch.replace(/\D+/g, '');

      if (adminCatalogTab === 'medicos') {
        const filtered = medicosList.filter(m => !q || normStr(m.nome).includes(q));
        if (!filtered.length) {
          return `<div style="padding:14px; text-align:center; color:var(--muted); font-size:0.83rem;">${q ? 'Nenhum Médico Regulador encontrado na busca.' : 'Nenhum Médico Regulador salvo ainda.'}</div>`;
        }
        return filtered.map(m => `
          <div class="check-item-row" style="flex-wrap:wrap; gap:8px;">
            <div class="check-item-info">
              <strong>👨‍⚕️ ${escapeHtml(m.nome)}</strong>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="btn btn-outline btn-sm" data-cat-edit-med="${escapeHtml(m.id)}">✏️ Editar</button>
              <button type="button" class="btn btn-secondary btn-sm" data-cat-del-med="${escapeHtml(m.id)}">🗑️ Excluir</button>
            </div>
          </div>
        `).join('');
      }

      if (adminCatalogTab === 'receivers') {
        const filtered = receiversList.filter(r =>
          !q || normStr(`${r.nome || ''} ${r.corenCrm || ''} ${r.hospital || ''}`).includes(q)
        );
        if (!filtered.length) {
          return `<div style="padding:14px; text-align:center; color:var(--muted); font-size:0.83rem;">${q ? 'Nenhum Recebedor do Hospital encontrado na busca.' : 'Nenhum Recebedor do Hospital salvo ainda.'}</div>`;
        }
        return filtered.map(r => `
          <div class="check-item-row" style="flex-wrap:wrap; gap:8px;">
            <div class="check-item-info">
              <strong>🏥 ${escapeHtml(r.nome)}</strong>
              <br>
              <small style="color:var(--muted);">
                ${r.corenCrm ? `<strong>${escapeHtml(r.corenCrm)}</strong> • ` : ''}Hospital: ${escapeHtml(r.hospital || 'HBSA')}
              </small>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="btn btn-outline btn-sm" data-cat-edit-rec="${escapeHtml(r.id)}">✏️ Editar</button>
              <button type="button" class="btn btn-secondary btn-sm" data-cat-del-rec="${escapeHtml(r.id)}">🗑️ Excluir</button>
            </div>
          </div>
        `).join('');
      }

      const filtered = patientsList.filter(p => {
        if (!q) return true;
        if (qDigits && (String(p.cpf11 || '').includes(qDigits) || String(p.vitimaTelefone || '').replace(/\D+/g, '').includes(qDigits))) return true;
        const blob = `${p.vitimaNome || ''} ${p.vitimaCpf || ''} ${p.vitimaTelefone || ''} ${p.vitimaEndereco || ''} ${p.vitimaNumero || ''} ${p.vitimaBairro || ''} ${p.vitimaCidade || ''} ${p.vitimaCep || ''}`;
        return normStr(blob).includes(q);
      });
      if (!filtered.length) {
        return `<div style="padding:14px; text-align:center; color:var(--muted); font-size:0.83rem;">${q ? 'Nenhum paciente encontrado para essa busca (nome, CPF ou rua).' : 'Nenhum paciente pré-cadastrado por CPF ainda.'}</div>`;
      }
      return filtered.map(p => {
        const addrParts = [
          p.vitimaEndereco ? `${p.vitimaEndereco}${p.vitimaNumero ? ', nº ' + p.vitimaNumero : ''}` : '',
          p.vitimaBairro || '',
          p.vitimaCidade || '',
          p.vitimaCep ? `CEP ${p.vitimaCep}` : ''
        ].filter(Boolean).join(' • ');
        const fmtPatTel = p.vitimaTelefone ? formatPhoneBR(p.vitimaTelefone, true) : '';
        const patTelIcon = fmtPatTel ? (getPhoneKindBR(fmtPatTel) === 'celular' ? '📱' : '☎️') : '';
        return `
          <div class="check-item-row" style="flex-wrap:wrap; gap:8px;">
            <div class="check-item-info">
              <strong>🪪 ${escapeHtml(p.vitimaNome)}</strong>
              <small style="color:var(--muted);"> • CPF: <code>${escapeHtml(p.vitimaCpf)}</code>${p.vitimaIdade ? ` • ${escapeHtml(p.vitimaIdade)}` : ''}${fmtPatTel ? ` • ${patTelIcon} ${escapeHtml(fmtPatTel)}` : ''}</small>
              <br>
              <small style="color:var(--muted);">
                📍 ${addrParts ? escapeHtml(addrParts) : '<em>Sem endereço residencial preenchido</em>'}
              </small>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="btn btn-outline btn-sm" data-cat-edit-pat="${escapeHtml(p.cpf11)}">✏️ Editar Endere&#8204;ço / Dados</button>
              <button type="button" class="btn btn-secondary btn-sm" data-cat-del-pat="${escapeHtml(p.cpf11)}">🗑️ Excluir</button>
            </div>
          </div>
        `;
      }).join('');
    };

    container.innerHTML = `
      <div class="card">
        <div class="card-title"><span>☁️ Base Interna Offline + Sincronização Google Drive &amp; Auto-Update</span></div>
        <p style="margin:0 0 10px; font-size:0.84rem; color:var(--muted);">
          O APK funciona <strong>100% offline</strong> (SQLite Nativo) e sincroniza automaticamente em tempo real pelo <strong>Google Drive da Central SAMU</strong> (logins, aprovações, ficha compartilhada da equipe, avarias, recebedores, médicos reguladores, pacientes por CPF e PDFs) — <strong>já pré-configurado de fábrica, sem precisar de nenhum Token nos celulares!</strong>
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
          <span class="type-badge" style="background:#e0f2fe; color:#0369a1;">👨‍⚕️ Médicos Reguladores: ${medicosRegCount}</span>
          <span class="type-badge type-ficha">🪪 CPFs na Base: ${patientsCount}</span>
          <span class="type-badge" style="${modCfg.condutorEnabled ? 'background:#dcfce7; color:#14532d;' : 'background:#fee2e2; color:#991b1b;'}">🚑 CK Motoristas: ${modCfg.condutorEnabled ? 'Ativo' : 'Desativado'}</span>
          <span class="type-badge" style="${modCfg.enfermagemEnabled ? 'background:#dcfce7; color:#14532d;' : 'background:#fee2e2; color:#991b1b;'}">🩺 CK Enfermagem: ${modCfg.enfermagemEnabled ? 'Ativo' : 'Desativado'}</span>
        </div>

        <div class="grid-3">
          <div class="field">
            <label>Hospital Padrão nas Fichas</label>
            <input type="text" id="adm-default-hospital" placeholder="HBSA" value="${escapeHtml(settings.defaultHospital || 'HBSA')}" />
          </div>
          <div class="field">
            <label>Canal Público de Auto-Update do APK (sem dados sensíveis)</label>
            <input type="text" id="adm-gh-repo" placeholder="guileao97/samu-fichas-e-checklist" value="${escapeHtml(settings.githubRepo || 'guileao97/samu-fichas-e-checklist')}" />
          </div>
          <div class="field">
            <label>Branch de Atualização</label>
            <input type="text" id="adm-gh-branch" placeholder="main" value="${escapeHtml(settings.githubBranch || 'main')}" />
          </div>
        </div>
        <input type="hidden" id="adm-gh-path" value="${escapeHtml(settings.githubFilePath || 'base_dados_samu.json')}" />
        <input type="hidden" id="adm-gh-token" value="" />
        ${ghMeta && ghMeta.lastSyncAt ? `
          <div style="font-size:0.78rem; color:#15803d; font-weight:700; margin-bottom:8px;">
            ✅ Última sincronização com Google Drive: ${escapeHtml(new Date(ghMeta.lastSyncAt).toLocaleString('pt-BR'))}
          </div>
        ` : ''}
        <div style="display:flex; flex-wrap:wrap; gap:8px;">
          <button type="button" class="btn btn-primary btn-sm" id="btn-adm-sync-gh">☁️ Salvar e Sincronizar com Google Drive</button>
          <button type="button" class="btn btn-whatsapp btn-sm" id="btn-adm-check-update">🚀 Buscar Atualização do APK</button>
          <button type="button" class="btn btn-outline btn-sm" id="btn-adm-export-db">📥 Baixar Backup JSON</button>
          <button type="button" class="btn btn-outline btn-sm" id="btn-adm-import-db">📂 Importar Backup JSON</button>
          <input type="file" id="inp-adm-import-file" accept=".json,application/json" class="hidden" />
        </div>
      </div>

      <div class="card" id="adm-checklist-modules-card">
        <div class="card-title"><span>🎛️ Ativar / Desativar Check Lists (Motoristas e Enfermagem)</span></div>
        <p style="margin:0 0 12px; font-size:0.83rem; color:var(--muted);">
          Controle quais Check Lists ficam liberados nos celulares da equipe. Quando <strong>desativado</strong>, o Check List <strong>não aparece para os funcionários que não são ADM</strong> (continua visível apenas para ADM) e sincroniza em tempo real com todos os celulares pelo Google Drive.
        </p>

        <div style="display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding:11px 13px; border-radius:10px; border:1.5px solid ${modCfg.condutorEnabled ? '#86efac' : '#fca5a5'}; background:${modCfg.condutorEnabled ? '#f0fdf4' : '#fef2f2'};">
            <div>
              <div style="font-weight:800; font-size:0.93rem; color:#0f172a; margin-bottom:4px;">🚑 Check List – Motoristas / Condutores</div>
              <span class="type-badge" style="${modCfg.condutorEnabled ? 'background:#dcfce7; color:#14532d;' : 'background:#fee2e2; color:#991b1b;'}">
                ${modCfg.condutorEnabled ? '✅ ATIVADO (Visível para Motoristas e ADM)' : '🔒 DESATIVADO (Oculto para funcionários não-ADM)'}
              </span>
            </div>
            <button type="button" class="btn ${modCfg.condutorEnabled ? 'btn-secondary' : 'btn-success'} btn-sm" id="btn-adm-toggle-ck-cond">
              ${modCfg.condutorEnabled ? '🔒 Desativar Check List Motoristas' : '✅ Ativar Check List Motoristas'}
            </button>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding:11px 13px; border-radius:10px; border:1.5px solid ${modCfg.enfermagemEnabled ? '#86efac' : '#fca5a5'}; background:${modCfg.enfermagemEnabled ? '#f0fdf4' : '#fef2f2'};">
            <div>
              <div style="font-weight:800; font-size:0.93rem; color:#0f172a; margin-bottom:4px;">🩺 Check List – Enfermagem (Técnicos e Enfermeiros)</div>
              <span class="type-badge" style="${modCfg.enfermagemEnabled ? 'background:#dcfce7; color:#14532d;' : 'background:#fee2e2; color:#991b1b;'}">
                ${modCfg.enfermagemEnabled ? '✅ ATIVADO (Visível para Enfermagem e ADM)' : '🔒 DESATIVADO (Oculto para funcionários não-ADM)'}
              </span>
            </div>
            <button type="button" class="btn ${modCfg.enfermagemEnabled ? 'btn-secondary' : 'btn-success'} btn-sm" id="btn-adm-toggle-ck-enf">
              ${modCfg.enfermagemEnabled ? '🔒 Desativar Check List Enfermagem' : '✅ Ativar Check List Enfermagem'}
            </button>
          </div>
        </div>
        ${modCfg.updatedAt ? `
          <div style="margin-top:8px; font-size:0.76rem; color:var(--muted);">
            🕒 Última alteração: <strong>${escapeHtml(new Date(modCfg.updatedAt).toLocaleString('pt-BR'))}</strong>${modCfg.updatedBy ? ` por <strong>${escapeHtml(modCfg.updatedBy)}</strong>` : ''}
          </div>
        ` : ''}
      </div>

      <div class="card">
        <div class="card-title"><span>☁️ Conexão com Google Drive da Central SAMU (Dados em Tempo Real + PDFs)</span></div>
        <p style="margin:0 0 10px; font-size:0.84rem; color:var(--muted);">
          URL oficial já pré-configurada de fábrica: centraliza os PDFs organizados em pastas por tipo/mês, libera abertura direta do link do PDF no celular sem pedir permissão extra (mantendo pastas e planilha privadas) e sincroniza todos os celulares da equipe em tempo real.
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
          <button type="button" class="btn btn-success btn-sm" id="btn-adm-open-folders">📁 Abrir Pasta Google Drive</button>
          <button type="button" class="btn btn-orange btn-sm" id="btn-adm-open-sheet">📊 Abrir Planilha de Controle</button>
        </div>
      </div>

      <div class="card" id="adm-remote-print-card">
        <div class="card-title"><span>🖨️ Impressão Automática na Base SAMU (De Qualquer Lugar via 4G / Wi-Fi)</span></div>
        <p style="margin:0 0 10px; font-size:0.83rem; color:var(--muted);">
          Envia todas as Fichas e Check Lists automaticamente pela internet (mesmo no 4G na rua, sem abrir portas no roteador) para a impressora conectada ao computador Windows da Base SAMU.
        </p>

        ${buildPrintAgentBannerHtml()}

        <div style="display:flex; flex-direction:column; gap:8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px; margin-bottom:10px;">
          <label style="display:flex; align-items:center; gap:8px; font-size:0.84rem; font-weight:700; color:#0f172a; cursor:pointer;">
            <input type="checkbox" id="adm-prt-auto-ficha" autocomplete="off" style="width:18px; height:18px;" ${printCfg.autoPrintFichas ? 'checked' : ''} />
            <span>📋 Imprimir <strong>Fichas de Atendimento</strong> automaticamente na Base ao enviar p/ o Google Drive</span>
          </label>
          <label style="display:flex; align-items:center; gap:8px; font-size:0.84rem; font-weight:700; color:#0f172a; cursor:pointer;">
            <input type="checkbox" id="adm-prt-auto-ck" autocomplete="off" style="width:18px; height:18px;" ${printCfg.autoPrintChecklists ? 'checked' : ''} />
            <span>🚑🩺 Imprimir <strong>Check Lists (Condutor e Enfermagem)</strong> automaticamente na Base ao enviar p/ o Google Drive</span>
          </label>
          <div class="field" style="margin:2px 0 0 26px;">
            <label style="font-size:0.78rem; color:#334155;">Turno que dispara a impressão automática dos Check Lists na Base</label>
            <select id="adm-prt-ck-shift" autocomplete="off">
              <option value="noturno_only" ${printCfg.checklistPrintShift !== 'all' ? 'selected' : ''}>🌙 Somente quando o Plantão Noturno / CK Noite enviar (Folha 100% preenchida Dia + Noite)</option>
              <option value="all" ${printCfg.checklistPrintShift === 'all' ? 'selected' : ''}>☀️🌙 Imprimir nos dois turnos separadamente (Diurno e Noturno)</option>
            </select>
          </div>
        </div>

        <div class="grid-2">
          <div class="field">
            <label>Modo das 2 Páginas A4 na Impressora da Base</label>
            <select id="adm-prt-duplex" autocomplete="off">
              <option value="duplex" ${printCfg.duplexMode !== 'simplex' ? 'selected' : ''}>🔄 Frente e Verso Automático (quando a impressora suportar)</option>
              <option value="simplex" ${printCfg.duplexMode === 'simplex' ? 'selected' : ''}>📄 2 Folhas Separadas (Apenas Frente)</option>
            </select>
          </div>
          <div class="field">
            <label>Quantidade de Cópias por Envio</label>
            <select id="adm-prt-copies" autocomplete="off">
              <option value="1" ${Number(printCfg.copies) === 1 ? 'selected' : ''}>1 cópia</option>
              <option value="2" ${Number(printCfg.copies) === 2 ? 'selected' : ''}>2 cópias</option>
              <option value="3" ${Number(printCfg.copies) === 3 ? 'selected' : ''}>3 cópias</option>
            </select>
          </div>
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
          <button type="button" class="btn btn-success btn-sm" id="btn-adm-save-print-cfg">💾 Salvar Config. de Impressão</button>
          <button type="button" class="btn btn-primary btn-sm" id="btn-adm-test-print-base" style="background:#1d4ed8; border-color:#1d4ed8;">🖨️ Imprimir Página de Teste na Base</button>
          <button type="button" class="btn btn-orange btn-sm" id="btn-adm-dl-print-bat">💻 Baixar Instalador p/ PC da Base (.BAT)</button>
          <button type="button" class="btn btn-outline btn-sm" id="btn-adm-refresh-print-queue">🔄 Atualizar Fila</button>
        </div>

        <div style="font-size:0.79rem; font-weight:800; color:#334155; margin-bottom:6px;">
          📄 Fila Recente de Impressão da Base (${printQueue.length})
        </div>
        <div style="max-height:250px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:10px; padding:4px 10px;">
          ${buildPrintQueueListHtml()}
        </div>
      </div>

      <div class="card" id="adm-catalog-card">
        <div class="card-title">
          <span>🗂️ Gerenciar Cadastros Automáticos (Pacientes, Médicos Reguladores e Hospital)</span>
        </div>
        <p style="margin:0 0 10px; font-size:0.83rem; color:var(--muted);">
          Edite endereços pré-cadastrados de pacientes, corrija nomes/CRM/COREN ou exclua registros salvos automaticamente — sincroniza com todos os celulares pelo Google Drive.
        </p>
        <div class="catalog-subtabs">
          <button type="button" class="catalog-subtab ${adminCatalogTab === 'patients' ? 'active' : ''}" data-cat-tab="patients">🪪 Pacientes / Endereços (${patientsCount})</button>
          <button type="button" class="catalog-subtab ${adminCatalogTab === 'medicos' ? 'active' : ''}" data-cat-tab="medicos">👨‍⚕️ Médicos Reguladores (${medicosRegCount})</button>
          <button type="button" class="catalog-subtab ${adminCatalogTab === 'receivers' ? 'active' : ''}" data-cat-tab="receivers">🏥 Recebedores Hospital (${receiversCount})</button>
        </div>
        <div class="input-action-row" style="margin-bottom:10px;">
          <input
            type="text"
            id="adm-catalog-search"
            autocomplete="off"
            value="${escapeHtml(adminCatalogSearch)}"
            placeholder="${adminCatalogTab === 'patients' ? '🔎 Buscar paciente por nome, CPF ou rua...' : (adminCatalogTab === 'medicos' ? '🔎 Buscar Médico Regulador...' : '🔎 Buscar Recebedor ou COREN...')}"
          />
          <button type="button" class="btn btn-success btn-sm" id="btn-adm-catalog-add" style="white-space:nowrap;">
            ${adminCatalogTab === 'patients' ? '➕ Novo Paciente' : (adminCatalogTab === 'medicos' ? '➕ Novo Médico' : '➕ Novo Recebedor')}
          </button>
        </div>
        <div id="adm-catalog-list-slot" style="max-height:360px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:10px; padding:4px 10px;">
          ${buildCatalogListHtml()}
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
              <label>Função / Perfil de Acesso (suporta Cargo Híbrido c/ ADM)</label>
              <select id="u-role">
                ${buildProfileSelectOptionsHtml('tecnico', false)}
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
            const roleIcon = window.SamuStorage.getUserRoleIcon(u);
            const roleBadge = `${roleIcon} ${window.SamuStorage.getUserRoleLabel(u)}`;
            const corenVal = u.coren || u.councilId || '';
            const isSelf = u.username.toLowerCase() === currentUser.username.toLowerCase();
            return `
              <div class="check-item-row" style="flex-wrap:wrap; gap:8px;">
                <div class="check-item-info">
                  <strong>${escapeHtml(u.name)}</strong> <small style="color:var(--muted);">(${escapeHtml(roleBadge)})</small>
                  ${isSelf ? `<span class="type-badge" style="background:#dcfce7; color:#14532d; margin-left:4px;">Você</span>` : ''}
                  <br>
                  <small style="color:var(--muted);">
                    Login: <code>${escapeHtml(u.username)}</code> • 🔑 Senha: <code class="pw-pill">${escapeHtml(u.password || '****')}</code>
                    ${u.cpf ? ` • CPF: ${escapeHtml(u.cpf)}` : ''}
                    ${corenVal ? ` • <strong>${escapeHtml(corenVal)}</strong>` : ''}
                  </small>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                  <button type="button" class="btn btn-outline btn-sm" data-adm-pw-u="${escapeHtml(u.username)}">🔑 Trocar Senha</button>
                  <button type="button" class="btn btn-outline btn-sm" data-edit-u="${escapeHtml(u.username)}">✏️ Editar</button>
                  ${!isSelf
                    ? `<button type="button" class="btn btn-secondary btn-sm" data-del-u="${escapeHtml(u.username)}">🗑️ Excluir Login</button>`
                    : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Oculta campo COREN quando perfil selecionado for Condutor / Condutor + ADM e ajusta exemplo p/ Enfermeiro vs Técnico
    const uRoleSel = document.getElementById('u-role');
    const uCorenWrap = document.getElementById('u-coren-wrap');
    const uCouncilInp = document.getElementById('u-council');
    const syncRoleCorenVisibility = () => {
      if (!uRoleSel || !uCorenWrap) return;
      uCorenWrap.style.display = profileChoiceUsesCoren(uRoleSel.value) ? '' : 'none';
      if (uCouncilInp) {
        uCouncilInp.placeholder = (uRoleSel.value === 'enfermeiro' || uRoleSel.value === 'enfermeiro_admin')
          ? 'Ex: COREN-SP 318.420-ENF'
          : 'Ex: COREN-SP 542.810-TE';
      }
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

    const btnToggleCkCond = document.getElementById('btn-adm-toggle-ck-cond');
    if (btnToggleCkCond) {
      btnToggleCkCond.addEventListener('click', async () => {
        const curCfg = getChecklistModulesCfg();
        const nextVal = !curCfg.condutorEnabled;
        btnToggleCkCond.disabled = true;
        btnToggleCkCond.textContent = 'Salvando e sincronizando...';
        try {
          await window.SamuStorage.saveChecklistModulesConfig(
            { condutorEnabled: nextVal },
            currentUser && currentUser.username
          );
          renderBottomNav();
          await refreshDraftCount();
          await refreshSyncBadge();
          renderAdminView(true);
          showToast(nextVal
            ? '✅ Check List dos Motoristas ATIVADO para todos os motoristas!'
            : '🔒 Check List dos Motoristas DESATIVADO (oculto para funcionários não-ADM)!');
        } catch (err) {
          samuAlert('Erro ao atualizar configuração do Check List: ' + err.message);
          renderAdminView(true);
        }
      });
    }

    const btnToggleCkEnf = document.getElementById('btn-adm-toggle-ck-enf');
    if (btnToggleCkEnf) {
      btnToggleCkEnf.addEventListener('click', async () => {
        const curCfg = getChecklistModulesCfg();
        const nextVal = !curCfg.enfermagemEnabled;
        btnToggleCkEnf.disabled = true;
        btnToggleCkEnf.textContent = 'Salvando e sincronizando...';
        try {
          await window.SamuStorage.saveChecklistModulesConfig(
            { enfermagemEnabled: nextVal },
            currentUser && currentUser.username
          );
          renderBottomNav();
          await refreshDraftCount();
          await refreshSyncBadge();
          renderAdminView(true);
          showToast(nextVal
            ? '✅ Check List da Enfermagem ATIVADO para toda a equipe de Enfermagem!'
            : '🔒 Check List da Enfermagem DESATIVADO (oculto para funcionários não-ADM)!');
        } catch (err) {
          samuAlert('Erro ao atualizar configuração do Check List: ' + err.message);
          renderAdminView(true);
        }
      });
    }

    // Salvar e sincronizar Base Interna com Google Drive
    const btnSyncGh = document.getElementById('btn-adm-sync-gh');
    if (btnSyncGh) {
      btnSyncGh.addEventListener('click', async () => {
        const githubRepo = document.getElementById('adm-gh-repo').value.trim() || 'guileao97/samu-fichas-e-checklist';
        const githubBranch = document.getElementById('adm-gh-branch').value.trim() || 'main';
        const githubFilePath = (document.getElementById('adm-gh-path') && document.getElementById('adm-gh-path').value.trim()) || 'base_dados_samu.json';
        const defaultHospital = document.getElementById('adm-default-hospital').value.trim() || 'HBSA';

        window.SamuStorage.saveSettings({
          githubRepo,
          githubBranch,
          githubFilePath,
          defaultHospital
        });

        if (!fichaState.destino || fichaState.destino === 'HBSA') {
          fichaState.destino = defaultHospital;
        }

        if (!window.SamuStorage.hasGitHubConfigured()) {
          await refreshSyncBadge();
          renderAdminView();
          showToast(`🗄️ Configurações salvas na Base Interna Offline (Hospital padrão: ${defaultHospital}).`);
          return;
        }

        if (!navigator.onLine) {
          await refreshSyncBadge();
          showToast('📴 Configuração salva! Sem internet agora — sincronizará com o Google Drive assim que conectar.');
          return;
        }

        btnSyncGh.disabled = true;
        btnSyncGh.textContent = 'Sincronizando com Google Drive...';
        try {
          const res = await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: true });
          renderBottomNav();
          await refreshSyncBadge();
          renderAdminView();
          showToast(res.pushed
            ? '☁️ Base Interna sincronizada e gravada no Google Drive com sucesso!'
            : '☁️ Base de dados sincronizada com o Google Drive com sucesso!');
        } catch (err) {
          samuAlert('Erro ao sincronizar com Google Drive: ' + err.message);
        } finally {
          btnSyncGh.disabled = false;
          btnSyncGh.textContent = '☁️ Salvar e Sincronizar com Google Drive';
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
          if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
            window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: true }).catch(() => {});
          }
          await refreshSyncBadge();
          showToast('Conectado ao Google Drive e sincronizado p/ todos os celulares!');
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

    const btnOpenFolders = document.getElementById('btn-adm-open-folders');
    if (btnOpenFolders) {
      btnOpenFolders.addEventListener('click', () => openInAppDriveFoldersModal());
    }
    const btnOpenSheet = document.getElementById('btn-adm-open-sheet');
    if (btnOpenSheet) {
      btnOpenSheet.addEventListener('click', () => openInAppControlSheetModal());
    }

    // Eventos do painel de Impressão Automática na Base SAMU
    const btnSavePrintCfg = document.getElementById('btn-adm-save-print-cfg');
    if (btnSavePrintCfg && window.SamuStorage.saveRemotePrintConfig) {
      btnSavePrintCfg.addEventListener('click', async () => {
        const autoPrintFichas = Boolean(document.getElementById('adm-prt-auto-ficha') && document.getElementById('adm-prt-auto-ficha').checked);
        const autoPrintChecklists = Boolean(document.getElementById('adm-prt-auto-ck') && document.getElementById('adm-prt-auto-ck').checked);
        const checklistPrintShift = (document.getElementById('adm-prt-ck-shift') && document.getElementById('adm-prt-ck-shift').value) || 'noturno_only';
        const duplexMode = (document.getElementById('adm-prt-duplex') && document.getElementById('adm-prt-duplex').value) || 'duplex';
        const copies = Number((document.getElementById('adm-prt-copies') && document.getElementById('adm-prt-copies').value) || 1) || 1;
        btnSavePrintCfg.disabled = true;
        btnSavePrintCfg.textContent = 'Salvando...';
        try {
          await window.SamuStorage.saveRemotePrintConfig({
            autoPrintFichas,
            autoPrintChecklists,
            checklistPrintShift,
            duplexMode,
            copies
          }, currentUser.username);
          await refreshSyncBadge();
          showToast('✅ Configuração da Impressora da Base salva e sincronizada para toda a equipe!');
          renderAdminView(true);
        } catch (err) {
          samuAlert('Erro ao salvar configuração de impressão: ' + err.message);
        } finally {
          btnSavePrintCfg.disabled = false;
          btnSavePrintCfg.textContent = '💾 Salvar Config. de Impressão';
        }
      });
    }

    const btnTestPrintBase = document.getElementById('btn-adm-test-print-base');
    if (btnTestPrintBase && window.SamuStorage.enqueueRemoteTestPage) {
      btnTestPrintBase.addEventListener('click', async () => {
        if (!window.SamuStorage.getSettings().scriptUrl) {
          samuAlert('Configure primeiro a URL do Google Drive acima para enviar a Página de Teste para a Base.');
          return;
        }
        btnTestPrintBase.disabled = true;
        btnTestPrintBase.textContent = '🖨️ Enviando Teste...';
        try {
          await window.SamuStorage.enqueueRemoteTestPage();
          await refreshSyncBadge();
          const ag = window.SamuStorage.getRemotePrintAgentStatus ? window.SamuStorage.getRemotePrintAgentStatus() : null;
          showToast(ag && ag.isOnline
            ? `🖨️ Página de Teste enviada para ${ag.printerName || ag.pcName} na Base!`
            : '🖨️ Página de Teste colocada na fila da nuvem! Sairá assim que o PC da Base estiver aberto.');
          renderAdminView(true);
        } catch (err) {
          samuAlert('Erro ao enviar Página de Teste: ' + err.message);
        } finally {
          btnTestPrintBase.disabled = false;
          btnTestPrintBase.textContent = '🖨️ Imprimir Página de Teste na Base';
        }
      });
    }

    const btnDlPrintBat = document.getElementById('btn-adm-dl-print-bat');
    if (btnDlPrintBat) {
      btnDlPrintBat.addEventListener('click', async () => {
        const curSet = window.SamuStorage.getSettings();
        const repo = (curSet.githubRepo || 'guileao97/samu-fichas-e-checklist').trim();
        const branch = (curSet.githubBranch || 'main').trim();
        const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/INSTALAR_IMPRESSORA_BASE_SAMU.bat`;
        btnDlPrintBat.disabled = true;
        btnDlPrintBat.textContent = 'Baixando...';
        try {
          if (!navigator.onLine) {
            throw new Error('Sem conexão no momento para baixar da nuvem.');
          }
          const resp = await fetch(rawUrl + '?t=' + Date.now(), { cache: 'no-store' });
          if (!resp.ok) {
            throw new Error('HTTP ' + resp.status);
          }
          let batText = await resp.text();
          if (curSet.scriptUrl) {
            batText = batText.replace(/set "SCRIPT_URL=[^"]*"/, `set "SCRIPT_URL=${curSet.scriptUrl}"`);
          }
          if (window.AndroidBridge) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              try { await navigator.clipboard.writeText(rawUrl); } catch (eC) {}
            }
            window.open(rawUrl, '_blank');
            showToast('💻 Link do Instalador (.BAT) aberto e copiado! Envie no WhatsApp Web do PC da Base.');
          } else {
            const blob = new Blob([batText], { type: 'application/octet-stream' });
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objUrl;
            a.download = 'INSTALAR_IMPRESSORA_BASE_SAMU.bat';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
            showToast('💻 Instalador INSTALAR_IMPRESSORA_BASE_SAMU.bat baixado! Execute no PC da Base.');
          }
        } catch (err) {
          samuAlert(
            '💻 Instalador do Servidor de Impressão da Base SAMU:\n\n' +
            '• Na pasta do projeto no computador, o arquivo "INSTALAR_IMPRESSORA_BASE_SAMU.bat" já está pronto para copiar/executar no PC da Base!\n' +
            '• Após publicar a atualização no GitHub (PUBLICAR_ATUALIZACAO_GITHUB.bat), este botão também baixa direto de:\n' +
            rawUrl
          );
        } finally {
          btnDlPrintBat.disabled = false;
          btnDlPrintBat.textContent = '💻 Baixar Instalador p/ PC da Base (.BAT)';
        }
      });
    }

    const btnRefreshPrintQueue = document.getElementById('btn-adm-refresh-print-queue');
    if (btnRefreshPrintQueue) {
      btnRefreshPrintQueue.addEventListener('click', async () => {
        btnRefreshPrintQueue.disabled = true;
        btnRefreshPrintQueue.textContent = '⏳ Atualizando...';
        try {
          if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
            await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: false });
          }
          renderAdminView(true);
          showToast('🔄 Status da Impressora da Base atualizado!');
        } catch (err) {
          renderAdminView(true);
        }
      });
    }

    container.querySelectorAll('[data-pjob-retry]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const jid = btn.dataset.pjobRetry;
        btn.disabled = true;
        btn.textContent = '🖨️...';
        try {
          await window.SamuStorage.retryRemotePrintJob(jid);
          showToast('🖨️ Reenviado para a Fila da Impressora da Base!');
          renderAdminView(true);
        } catch (err) {
          samuAlert('Erro ao reenviar impressão: ' + err.message);
          btn.disabled = false;
          btn.textContent = '🔄 Reimprimir';
        }
      });
    });

    container.querySelectorAll('[data-pjob-cancel]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const jid = btn.dataset.pjobCancel;
        btn.disabled = true;
        try {
          await window.SamuStorage.cancelRemotePrintJob(jid);
          showToast('✖ Impressão removida da fila pendente.');
          renderAdminView(true);
        } catch (err) {
          btn.disabled = false;
        }
      });
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
      const selVal = document.getElementById('u-role').value;
      const mapped = window.SamuStorage.mapProfileChoiceToFields(selVal);
      const targetUname = document.getElementById('u-username').value.trim().toLowerCase();
      if (currentUser && targetUname === currentUser.username.toLowerCase() && !mapped.isAdmin) {
        samuAlert('Para manter seu acesso administrativo atual, escolha um perfil com ADM (ex.: Condutor + ADM, Enfermeiro + ADM ou Somente ADM).');
        return;
      }
      const corenVal = mapped.role === 'condutor' ? '' : document.getElementById('u-council').value.trim();
      const userData = {
        name: document.getElementById('u-name').value.trim(),
        role: mapped.role,
        subRole: mapped.subRole,
        isAdmin: mapped.isAdmin,
        username: targetUname,
        password: document.getElementById('u-password').value.trim(),
        cpf: window.SamuStorage.formatCpf(document.getElementById('u-cpf').value),
        coren: mapped.role === 'enfermagem' ? corenVal : '',
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
        if (currentUser && targetUname === currentUser.username.toLowerCase()) {
          const refreshedSelf = window.SamuStorage.getLocalUsers().find(x => x.username.toLowerCase() === targetUname);
          if (refreshedSelf) {
            currentUser = Object.assign({}, currentUser, {
              name: refreshedSelf.name,
              password: refreshedSelf.password,
              role: refreshedSelf.role,
              subRole: window.SamuStorage.getUserSubRole(refreshedSelf),
              isAdmin: window.SamuStorage.isUserAdmin(refreshedSelf),
              coren: refreshedSelf.coren || refreshedSelf.councilId || '',
              councilId: refreshedSelf.coren || refreshedSelf.councilId || '',
              cpf: refreshedSelf.cpf || ''
            });
            window.SamuStorage.setSession(currentUser);
            updateTopbarUserHeader();
          }
        }
        if (navigator.onLine && window.SamuStorage.hasGitHubConfigured()) {
          try { await window.SamuStorage.syncInternalDbWithGitHub({ pushChanges: true }); } catch (eGh) {}
        }
        const curSettings = window.SamuStorage.getSettings();
        if (curSettings.scriptUrl && navigator.onLine) {
          const res = await window.SamuStorage.apiPost({
            action: 'saveUser',
            authUser: currentUser.username,
            authPass: currentUser.password,
            authName: currentUser.name,
            authRole: window.SamuStorage.getUserProfileChoice(currentUser),
            userData: Object.assign({}, userData, { role: selVal })
          });
          if (res && !res.ok) throw new Error(res.error);
        }
        renderBottomNav();
        const roleSavedLbl = window.SamuStorage.getUserRoleLabel(userData);
        showToast(`✅ "${userData.username}" salvo como ${roleSavedLbl} na Base Interna${window.SamuStorage.hasGitHubConfigured() ? ' e Google Drive' : ''}!`);
        renderAdminView();
      } catch (err) {
        samuAlert('Salvo na Base Interna, mas houve aviso na nuvem: ' + err.message);
        renderAdminView();
      } finally {
        btn.disabled = false;
        btn.textContent = '➕ Salvar Profissional na Base';
      }
    });

    container.querySelectorAll('[data-adm-pw-u]').forEach(btn => {
      btn.addEventListener('click', () => {
        openAdminResetPasswordModal(btn.dataset.admPwU, () => renderAdminView());
      });
    });

    container.querySelectorAll('[data-edit-u]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = users.find(u => u.username.toLowerCase() === btn.dataset.editU.toLowerCase());
        if (!target) return;
        document.getElementById('u-name').value = target.name || '';
        document.getElementById('u-role').value = window.SamuStorage.getUserProfileChoice(target);
        document.getElementById('u-username').value = target.username || '';
        document.getElementById('u-password').value = target.password || '';
        document.getElementById('u-cpf').value = target.cpf || '';
        document.getElementById('u-council').value = target.coren || target.councilId || '';
        syncRoleCorenVisibility();
        const saveBtn = document.getElementById('btn-save-user');
        if (saveBtn) saveBtn.textContent = `💾 Salvar Alterações de "${target.username}"`;
        document.getElementById('adm-user-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    container.querySelectorAll('[data-del-u]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = await deleteUserAccountWithSync(btn.dataset.delU);
        if (ok) renderAdminView(true);
      });
    });

    // Eventos do Gerenciador de Cadastros Automáticos (Pacientes por CPF, Médicos Reguladores e Recebedores do Hospital)
    const bindAdminCatalogRowActions = () => {
      const slot = document.getElementById('adm-catalog-list-slot');
      if (!slot) return;

      slot.querySelectorAll('[data-cat-edit-med]').forEach(btn => {
        btn.addEventListener('click', () => {
          openEditMedicoReguladorModal(btn.dataset.catEditMed, () => renderAdminView(true));
        });
      });
      slot.querySelectorAll('[data-cat-del-med]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const item = medicosList.find(m => m.id === btn.dataset.catDelMed);
          const nm = item ? item.nome : btn.dataset.catDelMed;
          if (!(await samuConfirm(`Excluir permanentemente o Médico Regulador "${nm}" da base e do Google Drive?`))) return;
          window.SamuStorage.deleteMedicoRegulador(btn.dataset.catDelMed);
          renderAdminView(true);
          showToast(`🗑️ "${nm}" excluído e sincronizado!`);
        });
      });

      slot.querySelectorAll('[data-cat-edit-rec]').forEach(btn => {
        btn.addEventListener('click', () => {
          openEditHospitalReceiverModal(btn.dataset.catEditRec, () => renderAdminView(true));
        });
      });
      slot.querySelectorAll('[data-cat-del-rec]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const item = receiversList.find(r => r.id === btn.dataset.catDelRec);
          const nm = item ? item.nome : btn.dataset.catDelRec;
          if (!(await samuConfirm(`Excluir permanentemente o recebedor "${nm}" da base e do Google Drive?`))) return;
          window.SamuStorage.deleteHospitalReceiver(btn.dataset.catDelRec);
          renderAdminView(true);
          showToast(`🗑️ "${nm}" excluído e sincronizado!`);
        });
      });

      slot.querySelectorAll('[data-cat-edit-pat]').forEach(btn => {
        btn.addEventListener('click', () => {
          openEditPatientCadastroModal(btn.dataset.catEditPat, () => renderAdminView(true));
        });
      });
      slot.querySelectorAll('[data-cat-del-pat]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const cpf11 = btn.dataset.catDelPat;
          const item = patientsList.find(p => p.cpf11 === cpf11);
          const nm = item ? `${item.vitimaNome} (CPF ${item.vitimaCpf})` : cpf11;
          if (!(await samuConfirm(`Excluir permanentemente o pré-cadastro de ${nm} da base interna e do Google Drive?`))) return;
          window.SamuStorage.deletePatientFromInternalDb(cpf11);
          renderAdminView(true);
          showToast('🗑️ Pré-cadastro excluído e sincronizado!');
        });
      });
    };

    bindAdminCatalogRowActions();

    container.querySelectorAll('[data-cat-tab]').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        adminCatalogTab = tabBtn.dataset.catTab;
        adminCatalogSearch = '';
        renderAdminView(true);
      });
    });

    const catSearchInp = document.getElementById('adm-catalog-search');
    if (catSearchInp) {
      catSearchInp.addEventListener('input', () => {
        adminCatalogSearch = catSearchInp.value || '';
        const slot = document.getElementById('adm-catalog-list-slot');
        if (slot) {
          slot.innerHTML = buildCatalogListHtml();
          bindAdminCatalogRowActions();
        }
      });
    }

    const catAddBtn = document.getElementById('btn-adm-catalog-add');
    if (catAddBtn) {
      catAddBtn.addEventListener('click', () => {
        if (adminCatalogTab === 'medicos') {
          openEditMedicoReguladorModal('', () => renderAdminView(true));
        } else if (adminCatalogTab === 'receivers') {
          openEditHospitalReceiverModal('', () => renderAdminView(true));
        } else {
          openEditPatientCadastroModal('', () => renderAdminView(true));
        }
      });
    }
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

  async function sendRecordToBasePrinter(record, preGeneratedPdf, triggerBtn) {
    if (!record) return false;
    if (!(await ensureChecklistCompleteBeforeAction(record, 'imprimir na Base SAMU'))) return false;
    const settings = window.SamuStorage.getSettings();
    if (!settings.scriptUrl) {
      samuAlert('Configure primeiro a URL do Google Drive (na aba ⚙️ Base/Drive) para enviar impressões remotas para a Base SAMU.');
      return false;
    }

    if (record.type === 'ficha' && record.data && !record._patientCheckedOnSend && (record.isDraft || record.syncStatus === 'draft' || !record.driveFileId)) {
      const patCheck = await handlePatientCadastroOnFichaSend(record.data);
      if (!patCheck.proceed) {
        if (patCheck.action === 'cancel') {
          const prevModal = document.getElementById('pdf-preview-modal');
          if (prevModal) prevModal.classList.add('hidden');
          if (activeTab === 'ficha') {
            fichaStep = 2;
            renderFichaView();
          }
        }
        return false;
      }
      record._patientCheckedOnSend = true;
    }

    const origText = triggerBtn ? triggerBtn.textContent : '';
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = '🖨️ Enviando p/ Base...';
    }
    try {
      const statusEl = document.getElementById('preview-drive-status');
      const isShowingThisInPreview = Boolean(previewCurrentRecord && previewCurrentRecord.id === record.id && statusEl);

      // Se o PDF ainda não foi enviado ao Google Drive, envia agora antes de colocar na fila da impressora
      if (!record.driveFileId && !record.driveUrl) {
        if (record.isDraft || record.syncStatus === 'draft') {
          record.isDraft = false;
          record.syncStatus = 'pending';
        }
        const generated = preGeneratedPdf || await window.SamuPDF.generatePdfForRecord(record);
        const upRes = await window.SamuStorage.uploadRecordToDrive(record, generated.base64, { skipAutoPrint: true });
        await refreshDraftCount();
        await refreshSyncBadge();

        if (!upRes.synced) {
          record.pendingAutoPrint = true;
          await window.SamuStorage.saveRecordLocal(record, { skipPatientUpsert: true });
          if (isShowingThisInPreview) {
            statusEl.textContent = '⏳ Sem internet agora: salvo na fila — enviará ao Drive e imprimirá na Base automaticamente!';
          }
          showToast('📴 Sem sinal agora! Salvo na fila para imprimir na Base assim que o 4G voltar.');
          return true;
        }
      }

      await window.SamuStorage.enqueueRemotePrintJob(record, { trigger: 'manual' });
      await refreshSyncBadge();

      const ag = window.SamuStorage.getRemotePrintAgentStatus ? window.SamuStorage.getRemotePrintAgentStatus() : null;
      if (isShowingThisInPreview) {
        statusEl.textContent = (ag && ag.isOnline)
          ? `🖨️ Enviado para a Impressora da Base (${ag.printerName || ag.pcName})! Imprimindo em instantes...`
          : '🖨️ Enviado para a Fila da Impressora da Base na nuvem!';
      }
      showToast((ag && ag.isOnline)
        ? `🖨️ Enviado p/ Impressora da Base (${ag.printerName || ag.pcName})!`
        : '🖨️ Enviado para a Fila da Impressora da Base SAMU!');
      return true;
    } catch (err) {
      samuAlert('Erro ao enviar para a Impressora da Base: ' + (err.message || err));
      return false;
    } finally {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = origText;
      }
    }
  }

  async function openPdfPreviewModal(record, preGenerated, uploadResult) {
    const modal = document.getElementById('pdf-preview-modal');
    const pagesBox = document.getElementById('preview-pages-container');
    const statusEl = document.getElementById('preview-drive-status');
    const btnPrevReg = document.getElementById('btn-preview-regulacao');
    if (btnPrevReg) {
      btnPrevReg.classList.toggle('hidden', !record || record.type !== 'ficha');
    }
    const btnPrevDelAdmin = document.getElementById('btn-preview-delete-admin');
    if (btnPrevDelAdmin) {
      const isAdm = Boolean(currentUser && window.SamuStorage.isUserAdmin(currentUser));
      const existingSaved = (isAdm && record && record.id) ? await window.SamuStorage.getRecordById(record.id) : null;
      btnPrevDelAdmin.classList.toggle('hidden', !existingSaved);
      btnPrevDelAdmin.disabled = false;
      btnPrevDelAdmin.textContent = (existingSaved && existingSaved.syncStatus === 'draft')
        ? '🗑️ Excluir Rascunho'
        : '🗑️ Excluir do App e Drive';
    }

    modal.classList.remove('hidden');
    pagesBox.innerHTML = `<div style="padding:40px; color:#cbd5e1;">Gerando páginas oficiais em alta resolução...</div>`;

    const generated = preGenerated || await window.SamuPDF.generatePdfForRecord(record);
    previewCurrentRecord = record;
    previewGeneratedPdf = generated;

    if (uploadResult) {
      if (uploadResult.synced) {
        const waitingNight = !uploadResult.printQueued && isDaytimeChecklistWaitingNightPrint(record);
        statusEl.textContent = uploadResult.printQueued
          ? '✅ Salvo no Google Drive e enviado automaticamente para a Impressora da Base!'
          : (waitingNight
            ? '✅ Turno Diurno salvo no Google Drive! (Imprimirá automaticamente na Base quando o Noturno concluir a folha)'
            : '✅ Salvo e enviado automaticamente para o Google Drive!');
      } else if (uploadResult.reason === 'no_url') {
        statusEl.textContent = '💾 Salvo no aparelho (conecte o Google Drive em Equipe/Drive para envio automático).';
      } else {
        statusEl.textContent = uploadResult.printPendingOffline
          ? '⏳ Salvo no aparelho! Sem internet agora — enviará ao Google Drive e imprimirá na Base automaticamente.'
          : '⏳ Salvo no aparelho! Sem internet agora — enviará ao Google Drive automaticamente.';
      }
    } else if (record && record.type === 'checklist_condutor' && !validateCondutorChecklist(record.data).valid) {
      statusEl.textContent = '⚠️ Check List incompleto — preencha todos os campos antes de enviar ou compartilhar.';
    } else if (record && record.type === 'checklist_enfermagem' && !validateEnfermagemChecklist(record.data).valid) {
      statusEl.textContent = '⚠️ Check List incompleto — preencha todos os campos antes de enviar ou compartilhar.';
    } else if (record.driveUrl) {
      const pJob = (record.id && window.SamuStorage.getRecordPrintStatus) ? window.SamuStorage.getRecordPrintStatus(record.id) : null;
      if (pJob && pJob.status === 'printed') {
        statusEl.textContent = `☁️ No Google Drive • 🖨️ Já impresso na Base${pJob.printerName ? ' (' + pJob.printerName + ')' : ''}`;
      } else if (pJob && pJob.status === 'pending') {
        statusEl.textContent = '☁️ No Google Drive • ⏳ Na fila de impressão da Base SAMU';
      } else {
        statusEl.textContent = '☁️ Este PDF já está arquivado no Google Drive.';
      }
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
