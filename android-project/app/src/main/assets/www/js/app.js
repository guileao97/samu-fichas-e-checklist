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
      itensDiurno: {},
      itensNoturno: {},
      avariasDiurno: [],
      avariasNoturno: [],
      obsDiurno: '',
      obsNoturno: '',
      sigCondutorDiurno: isDiurno ? savedSig : '',
      sigCondutorNoturno: !isDiurno ? savedSig : ''
    };
    return applySavedAvariasToCondutorState(blankCond, true);
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
    document.getElementById('btn-preview-drive').addEventListener('click', async () => {
      if (!previewCurrentRecord || !previewGeneratedPdf) return;
      if (!(await ensureChecklistCompleteBeforeAction(previewCurrentRecord, 'enviar ao Google Drive'))) return;
      const settings = window.SamuStorage.getSettings();
      if (!settings.scriptUrl) {
        samuAlert('Configure primeiro a URL do Google Apps Script (na aba ⚙️ Base/Drive) para enviar direto ao Google Drive.');
        return;
      }
      const btn = document.getElementById('btn-preview-drive');
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      try {
        if (previewCurrentRecord.isDraft || previewCurrentRecord.syncStatus === 'draft') {
          previewCurrentRecord.isDraft = false;
          previewCurrentRecord.syncStatus = 'pending';
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
            if (activeTab === 'condutor') {
              const activeEl = document.activeElement;
              const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
              if (!isTyping) renderCondutorView();
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
      } else if (ev.key === 'samu_viatura_avarias_v1' && !editingCondutorId && condutorState) {
        applySavedAvariasToCondutorState(condutorState, true);
        if (activeTab === 'condutor') {
          const activeEl = document.activeElement;
          const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
          if (!isTyping) renderCondutorView();
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
      if (typeof MutationObserver === 'function') {
        const autofillObserver = new MutationObserver(() => {
          disableExternalAutofillInContainer(mainViewEl);
        });
        autofillObserver.observe(mainViewEl, { childList: true, subtree: true });
      }
    }
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
    currentCrewSessionId = sessionId || (editingFichaId ? ('sf_rec_' + editingFichaId) : uid('sf'));
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
    editingCondutorId = null;
    condutorValidationActive = false;

    const draftEnf = await window.SamuStorage.getDraft(user.username, 'checklist_enfermagem');
    enfermagemState = (draftEnf && draftEnf.data) ? Object.assign(createEmptyEnfermagem(), draftEnf.data) : createEmptyEnfermagem();
    if (user.role === 'enfermagem') {
      if (!enfermagemState.responsavelNome) enfermagemState.responsavelNome = user.name;
      if (!enfermagemState.responsavelCoren && userCoren) enfermagemState.responsavelCoren = userCoren;
    }
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
    const tabs = getNavTabsForUser(currentUser);
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
              <input type="text" inputmode="numeric" id="f-occ-cnt1" autocomplete="off" placeholder="(16) 999&#8204;99-9999" data-f="ocorrenciaContato" value="${escapeHtml(d.ocorrenciaContato)}" />
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
              <label>C&#8204;PF (puxa cadastro salvo / Wi-Fi)</label>
              <div class="input-action-row">
                <input type="text" inputmode="numeric" id="f-vit-doc1" autocomplete="off" placeholder="000.000&#8204;.000-00" data-f="vitimaCpf" value="${escapeHtml(d.vitimaCpf)}" />
                <button type="button" class="btn-lookup" id="btn-lookup-cpf" title="Buscar dados do paciente pelo CPF">🔍 C&#8204;PF</button>
              </div>
              <div id="cpf-lookup-hint" class="field-hint">${cpfHintInit}</div>
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
          <div class="grid-dn-age">
            <div class="field">
              <label>Data de Nascimento (DN)</label>
              <input type="date" id="f-vit-nasc" autocomplete="off" data-f="vitimaDn" value="${escapeHtml(d.vitimaDn)}" />
            </div>
            <div class="field">
              <label>Idade</label>
              <input type="text" id="f-vit-anos" autocomplete="off" placeholder="Ex: 54 anos" data-f="vitimaIdade" value="${escapeHtml(d.vitimaIdade)}" />
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
                            <button type="button" class="receiver-chip-del" data-del-medico="${escapeHtml(m.id)}" title="Remover da lista">×</button>
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
    if (nextBtn) nextBtn.addEventListener('click', () => { if (fichaStep < 6) { if (crewDirtySinceLastPush) flushCrewCloudPushNow(); openSelectBoxKey = ''; fichaStep++; renderFichaView(); window.scrollTo(0, 0); } });

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
          applyField('vitimaNome', 'f-vit-ident', p.vitimaNome);
          applyField('vitimaDn', 'f-vit-nasc', p.vitimaDn);
          const calcAge = p.vitimaDn ? calcAgeFromDn(p.vitimaDn) : '';
          applyField('vitimaIdade', 'f-vit-anos', calcAge || p.vitimaIdade);
          applyField('vitimaRg', 'f-vit-doc2', p.vitimaRg);
          applyField('vitimaCns', 'f-vit-doc3', p.vitimaCns);
          applyField('vitimaCep', 'f-vit-cod', p.vitimaCep);
          applyField('vitimaCidade', 'f-vit-mun', p.vitimaCidade);
          applyField('vitimaBairro', 'f-vit-area', p.vitimaBairro);
          applyField('vitimaEndereco', 'f-vit-loc1', p.vitimaEndereco);
          applyField('vitimaNumero', 'f-vit-loc2', p.vitimaNumero);
          applyField('vitimaNaturalidade', 'f-vit-orig', p.vitimaNaturalidade);
          applyField('vitimaPai', 'f-vit-fil1', p.vitimaPai);
          applyField('vitimaMae', 'f-vit-fil2', p.vitimaMae);

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

          persistFichaDraft({ immediate: true });
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
            if (curDigits.length < 11) {
              if (hint) hint.innerHTML = '';
            } else if (curDigits.length === 11 && curDigits !== prevDigits) {
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

    container.querySelectorAll('[data-del-medico]').forEach(delBtn => {
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const medId = delBtn.dataset.delMedico;
        if (!(await samuConfirm('Remover este Médico Regulador da lista rápida?'))) return;
        window.SamuStorage.deleteMedicoRegulador(medId);
        renderFichaView();
      });
    });

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

        const generated = await window.SamuPDF.generatePdfForRecord(record);
        await window.SamuStorage.saveRecordLocal(record);
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
    const container = document.getElementById('main-view');
    const d = condutorState;
    const isDiurno = d.turnoAtivo === 'DIURNO';
    const itensMap = isDiurno ? d.itensDiurno : d.itensNoturno;
    const avariasArr = isDiurno ? d.avariasDiurno : d.avariasNoturno;
    const allItems = window.SAMU_SCHEMA.condutorLeftItems.concat(window.SAMU_SCHEMA.condutorRightItems);
    const filledCount = allItems.filter(it => Boolean(String(itensMap[it.id] || '').trim())).length;

    const val = validateCondutorChecklist(d);
    if (condutorValidationActive && val.valid) {
      condutorValidationActive = false;
    }
    const showErr = condutorValidationActive && !val.valid;
    const abastStatus = getCondutorAbastStatus(d);

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
        <div>
          <strong style="font-size:1.05rem;">🚑 Check List – Condutor / Socorrista</strong>
          <div style="font-size:0.78rem; color:var(--muted);">Conferidos no turno: ${filledCount} de ${allItems.length} itens</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-reset-condutor">🗑️ Limpar</button>
      </div>

      ${renderQuickDraftBarHtml('condutor')}

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
          Escolha o tipo de avaria abaixo e <strong>toque em cima do desenho da ambulância</strong> onde houver detalhe (toque num ponto vermelho para removê-lo quando for reparado):
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
      await window.SamuStorage.clearDraft(currentUser.username, 'checklist_condutor');
      renderCondutorView();
    });

    document.getElementById('cond-data').addEventListener('input', e => { d.data = e.target.value; saveCondDraft(); refreshCondValidationInPlace(); });
    document.getElementById('cond-turno').addEventListener('change', e => {
      d.turnoAtivo = e.target.value;
      if (d.turnoAtivo === 'DIURNO' && !d.condutorDiurno && currentUser) d.condutorDiurno = currentUser.name;
      if (d.turnoAtivo === 'NOTURNO' && !d.condutorNoturno && currentUser) d.condutorNoturno = currentUser.name;
      if (!editingCondutorId) {
        applySavedAvariasToCondutorState(d, true);
      }
      saveCondDraft();
      renderCondutorView();
    });

    container.querySelectorAll('[data-viatura]').forEach(btn => {
      btn.addEventListener('click', () => {
        d.viaturaId = btn.dataset.viatura;
        if (!editingCondutorId) {
          applySavedAvariasToCondutorState(d, true);
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
    if (abastL) abastL.addEventListener('input', e => { d.abastRealizado = 'SIM'; d.abastLitros = e.target.value; saveCondDraft(); refreshCondValidationInPlace(); });
    if (abastH) abastH.addEventListener('input', e => { d.abastRealizado = 'SIM'; d.abastHora = e.target.value; saveCondDraft(); refreshCondValidationInPlace(); });
    if (abastKm) abastKm.addEventListener('input', e => { d.abastRealizado = 'SIM'; d.abastKm = e.target.value; saveCondDraft(); refreshCondValidationInPlace(); });
    if (btnAbastHoraNow && abastH) {
      btnAbastHoraNow.addEventListener('click', () => {
        const t = nowHHMM();
        d.abastRealizado = 'SIM';
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
        if (window.SamuStorage.saveViaturaAvarias) {
          window.SamuStorage.saveViaturaAvarias(
            d.viaturaId || 'master_29',
            d.outraPlaca || '',
            isDiurno ? d.avariasDiurno : d.avariasNoturno,
            currentUser ? currentUser.username : ''
          );
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
    const doneAll = sections.reduce((acc, s) => acc + s.items.filter(i => Boolean(String(targetMap[i.id] || '').trim())).length, 0);

    const val = validateEnfermagemChecklist(d);
    if (enfermagemValidationActive && val.valid) {
      enfermagemValidationActive = false;
    }
    const showErr = enfermagemValidationActive && !val.valid;

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

      ${renderQuickDraftBarHtml('enfermagem')}

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

    document.getElementById('enf-data').addEventListener('input', e => { d.data = e.target.value; saveEnfDraft(); refreshEnfValidationAndCountersInPlace(); });
    document.getElementById('enf-turno').addEventListener('change', e => { d.turno = e.target.value; saveEnfDraft(); renderEnfermagemView(); });
    document.getElementById('enf-nome').addEventListener('input', e => { d.responsavelNome = e.target.value; saveEnfDraft(); refreshEnfValidationAndCountersInPlace(); });
    document.getElementById('enf-coren').addEventListener('input', e => { d.responsavelCoren = e.target.value; saveEnfDraft(); refreshEnfValidationAndCountersInPlace(); });
    const obs1Inp = document.getElementById('enf-obs-1');
    const obs2Inp = document.getElementById('enf-obs-2');
    obs1Inp.addEventListener('input', e => { d.obsPagina1 = e.target.value; saveEnfDraft(); refreshEnfValidationAndCountersInPlace(); });
    obs2Inp.addEventListener('input', e => { d.obsPagina2 = e.target.value; saveEnfDraft(); refreshEnfValidationAndCountersInPlace(); });

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
  }

  /* ==========================================================================
   * ABA 4: HISTÓRICO COM BUSCA DE PACIENTES & CONTROLE POR PERFIL
   * ========================================================================== */
  async function renderHistoricoView() {
    const container = document.getElementById('main-view');
    const isAdmin = window.SamuStorage.isUserAdmin(currentUser);
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
  async function renderAdminView() {
    if (!currentUser || !window.SamuStorage.isUserAdmin(currentUser)) return;
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
          authPass: currentUser.password,
          authName: currentUser.name,
          authRole: window.SamuStorage.getUserProfileChoice(currentUser)
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
    const medicosRegCount = window.SamuStorage.getMedicosReguladores ? window.SamuStorage.getMedicosReguladores().length : 0;
    const patientsCount = Object.keys(window.SamuStorage.getInternalPatientsMap() || {}).length;
    const ghMeta = window.SamuStorage.getGitHubMeta();

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
        if (ok) renderAdminView();
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
        statusEl.textContent = '✅ Salvo e enviado automaticamente para o Google Drive!';
      } else if (uploadResult.reason === 'no_url') {
        statusEl.textContent = '💾 Salvo no aparelho (conecte o Google Drive em Equipe/Drive para envio automático).';
      } else {
        statusEl.textContent = '⏳ Salvo no aparelho! Sem internet agora — enviará ao Google Drive automaticamente.';
      }
    } else if (record && record.type === 'checklist_condutor' && !validateCondutorChecklist(record.data).valid) {
      statusEl.textContent = '⚠️ Check List incompleto — preencha todos os campos antes de enviar ou compartilhar.';
    } else if (record && record.type === 'checklist_enfermagem' && !validateEnfermagemChecklist(record.data).valid) {
      statusEl.textContent = '⚠️ Check List incompleto — preencha todos os campos antes de enviar ou compartilhar.';
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
