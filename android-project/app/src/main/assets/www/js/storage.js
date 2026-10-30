/* ============================================================================
 * SAMU 192 – ORLÂNDIA-SP | BASE DE DADOS INTERNA OFFLINE (IndexedDB + Cache)
 * + CONSULTA E SINCRONIZAÇÃO AUTOMÁTICA COM GITHUB E GOOGLE DRIVE
 * ============================================================================ */

(function() {
  const DB_NAME = 'samu_orlandia_db_v1';
  const DB_VERSION = 2;

  const LS_SETTINGS = 'samu_settings_v1';
  const LS_USERS = 'samu_users_cache_v1';
  const LS_DELETED_USERS = 'samu_deleted_users_v1';
  const LS_HOSP_RECEIVERS = 'samu_hosp_receivers_v1';
  const LS_PATIENTS_DB = 'samu_patients_db_v1';
  const LS_GH_META = 'samu_github_meta_v1';
  const LS_SESSION = 'samu_session_v1';
  const LS_USER_SIGS = 'samu_saved_sigs_v1';
  const LS_LAST_KM = 'samu_last_km_final_v1';
  const LS_CREW_TEAMS = 'samu_crew_teams_v1';
  const LS_SHARED_FICHAS = 'samu_shared_fichas_v1';
  const LS_VIATURA_AVARIAS = 'samu_viatura_avarias_v1';
  const LS_MEDICOS_REGULADORES = 'samu_medicos_reguladores_v1';
  const LS_SEED_V2_DONE = 'samu_seed_crew_demo_v1';

  const DEFAULT_USERS = [
    {
      username: 'admin',
      password: 'samu192',
      name: 'Coordenação SAMU Orlândia',
      role: 'admin',
      subRole: 'admin',
      cpf: '',
      coren: '',
      councilId: 'ADM-192',
      status: 'approved',
      active: true,
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    {
      username: 'condutor',
      password: '1234',
      name: 'Condutor Socorrista 01',
      role: 'condutor',
      subRole: 'condutor',
      cpf: '111.222.333-44',
      coren: '',
      councilId: '',
      status: 'approved',
      active: true,
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    {
      username: 'condutor2',
      password: '1234',
      name: 'Condutor Socorrista 02',
      role: 'condutor',
      subRole: 'condutor',
      cpf: '333.444.555-66',
      coren: '',
      councilId: '',
      status: 'approved',
      active: true,
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    {
      username: 'enfermagem',
      password: '1234',
      name: 'Técnico de Enfermagem 01',
      role: 'enfermagem',
      subRole: 'tecnico',
      cpf: '222.333.444-55',
      coren: 'COREN-SP 542.810-TE',
      councilId: 'COREN-SP 542.810-TE',
      status: 'approved',
      active: true,
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    {
      username: 'enfermeiro',
      password: '1234',
      name: 'Enfermeiro(a) 01',
      role: 'enfermagem',
      subRole: 'enfermeiro',
      cpf: '444.555.666-77',
      coren: 'COREN-SP 318.420-ENF',
      councilId: 'COREN-SP 318.420-ENF',
      status: 'approved',
      active: true,
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  ];

  let dbPromise = null;
  let useMemDB = false;
  const memRecords = new Map();
  const memDrafts = new Map();
  const memKV = {};

  function isNativeSqliteActive() {
    try {
      return Boolean(
        window.AndroidBridge &&
        typeof window.AndroidBridge.hasNativeSqlite === 'function' &&
        window.AndroidBridge.hasNativeSqlite()
      );
    } catch (e) {
      return false;
    }
  }

  const safeLS = {
    getItem(k) {
      if (isNativeSqliteActive()) {
        try {
          const sqlVal = window.AndroidBridge.dbGetKv(k);
          if (sqlVal !== null && sqlVal !== undefined) return String(sqlVal);
          // Migração automática se existia algo no localStorage antes do SQLite
          const legacy = window.localStorage ? window.localStorage.getItem(k) : null;
          if (legacy !== null && legacy !== undefined) {
            window.AndroidBridge.dbSetKv(k, String(legacy));
            return legacy;
          }
          return null;
        } catch (eSql) {}
      }
      try { return window.localStorage.getItem(k); }
      catch (e) { return Object.prototype.hasOwnProperty.call(memKV, k) ? memKV[k] : null; }
    },
    setItem(k, v) {
      const strVal = String(v);
      if (isNativeSqliteActive()) {
        try { window.AndroidBridge.dbSetKv(k, strVal); } catch (eSql) {}
      }
      try { window.localStorage.setItem(k, strVal); }
      catch (e) { memKV[k] = strVal; }
    },
    removeItem(k) {
      if (isNativeSqliteActive()) {
        try { window.AndroidBridge.dbRemoveKv(k); } catch (eSql) {}
      }
      try { window.localStorage.removeItem(k); }
      catch (e) { delete memKV[k]; }
    }
  };

  const pendingNativeCalls = {};
  let nativeReqCounter = 1;

  window.__onAndroidHttpResult = function(reqId, ok, responseText) {
    const cb = pendingNativeCalls[reqId];
    if (!cb) return;
    delete pendingNativeCalls[reqId];
    if (!ok) {
      cb.reject(new Error(responseText || 'Falha de conexão HTTP.'));
      return;
    }
    if (cb.rawText) {
      cb.resolve(responseText);
      return;
    }
    try {
      cb.resolve(JSON.parse(responseText));
    } catch (err) {
      cb.reject(new Error('Resposta JSON inválida recebida do servidor.'));
    }
  };

  function openDB() {
    if (useMemDB) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        if (!window.indexedDB) {
          useMemDB = true;
          resolve(null);
          return;
        }
        const req = window.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function(ev) {
          const db = ev.target.result;
          if (!db.objectStoreNames.contains('records')) {
            const store = db.createObjectStore('records', { keyPath: 'id' });
            store.createIndex('createdBy', 'createdBy', { unique: false });
            store.createIndex('type', 'type', { unique: false });
            store.createIndex('syncStatus', 'syncStatus', { unique: false });
          }
          if (!db.objectStoreNames.contains('drafts')) {
            db.createObjectStore('drafts', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('internal_kv')) {
            db.createObjectStore('internal_kv', { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { useMemDB = true; resolve(null); };
      } catch (e) {
        useMemDB = true;
        resolve(null);
      }
    });
    return dbPromise;
  }

  // Espelha tabelas críticas da Base Interna no IndexedDB para máxima resiliência offline
  async function mirrorKvToIndexedDB(key, valueStr) {
    try {
      const db = await openDB();
      if (!db || !db.objectStoreNames.contains('internal_kv')) return;
      const tx = db.transaction('internal_kv', 'readwrite');
      tx.objectStore('internal_kv').put({ key, value: valueStr, updatedAt: new Date().toISOString() });
    } catch (e) {}
  }

  async function initInternalDb() {
    try {
      const db = await openDB();
      if (!db || !db.objectStoreNames.contains('internal_kv')) return;
      const keys = [LS_USERS, LS_DELETED_USERS, LS_HOSP_RECEIVERS, LS_MEDICOS_REGULADORES, LS_PATIENTS_DB, LS_SETTINGS, LS_LAST_KM, LS_CREW_TEAMS, LS_SHARED_FICHAS, LS_VIATURA_AVARIAS];
      await Promise.all(keys.map(k => new Promise((resolve) => {
        try {
          const cur = safeLS.getItem(k);
          if (cur) {
            mirrorKvToIndexedDB(k, cur);
            resolve();
            return;
          }
          const tx = db.transaction('internal_kv', 'readonly');
          const req = tx.objectStore('internal_kv').get(k);
          req.onsuccess = () => {
            if (req.result && req.result.value) {
              safeLS.setItem(k, req.result.value);
            }
            resolve();
          };
          req.onerror = () => resolve();
        } catch (err) {
          resolve();
        }
      })));
    } catch (e) {}
  }

  function saveInternalJson(lsKey, obj) {
    const str = JSON.stringify(obj);
    safeLS.setItem(lsKey, str);
    mirrorKvToIndexedDB(lsKey, str);
  }

  const DEFAULT_GITHUB_REPO = 'guileao97/samu-fichas-e-checklist';

  function getSettings() {
    const defaults = {
      scriptUrl: '',
      rootFolderUrl: '',
      spreadsheetUrl: '',
      cpfApiUrl: '',
      githubRepo: DEFAULT_GITHUB_REPO,
      githubBranch: 'main',
      githubFilePath: 'base_dados_samu.json',
      githubToken: '',
      defaultHospital: 'HBSA'
    };
    try {
      const raw = safeLS.getItem(LS_SETTINGS);
      if (!raw) return defaults;
      const merged = Object.assign({}, defaults, JSON.parse(raw));
      if (!merged.githubRepo || !String(merged.githubRepo).trim()) {
        merged.githubRepo = DEFAULT_GITHUB_REPO;
      }
      return merged;
    } catch (e) {
      return defaults;
    }
  }

  function saveSettings(partial) {
    const cur = getSettings();
    const next = Object.assign({}, cur, partial);
    if (next.scriptUrl) next.scriptUrl = next.scriptUrl.trim();
    if (next.githubRepo) next.githubRepo = next.githubRepo.trim();
    if (next.githubBranch) next.githubBranch = next.githubBranch.trim() || 'main';
    if (next.githubFilePath) next.githubFilePath = next.githubFilePath.trim() || 'base_dados_samu.json';
    if (next.githubToken) next.githubToken = next.githubToken.trim();
    const driveChanged = (
      (partial && Object.prototype.hasOwnProperty.call(partial, 'scriptUrl') && next.scriptUrl !== cur.scriptUrl) ||
      (partial && Object.prototype.hasOwnProperty.call(partial, 'rootFolderUrl') && next.rootFolderUrl !== cur.rootFolderUrl) ||
      (partial && Object.prototype.hasOwnProperty.call(partial, 'spreadsheetUrl') && next.spreadsheetUrl !== cur.spreadsheetUrl)
    );
    if (driveChanged && !(partial && partial._fromRemoteMerge)) {
      next.driveUpdatedAt = new Date().toISOString();
    }
    delete next._fromRemoteMerge;
    saveInternalJson(LS_SETTINGS, next);
    if (driveChanged && !(partial && partial._fromRemoteMerge)) {
      markGitHubDirty();
    }
    return next;
  }

  function getGitHubMeta() {
    try {
      const raw = safeLS.getItem(LS_GH_META);
      return raw ? JSON.parse(raw) : { dirty: false, lastSyncAt: '', lastError: '' };
    } catch (e) {
      return { dirty: false, lastSyncAt: '', lastError: '' };
    }
  }

  function setGitHubMeta(partial) {
    const next = Object.assign({}, getGitHubMeta(), partial);
    safeLS.setItem(LS_GH_META, JSON.stringify(next));
    return next;
  }

  function markGitHubDirty() {
    setGitHubMeta({ dirty: true });
  }

  /* ===================== FORMATAÇÃO / VALIDAÇÃO DE CPF ===================== */
  function formatCpf(raw) {
    const d = String(raw || '').replace(/\D+/g, '').slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  function isValidCpf(raw) {
    const cpf = String(raw || '').replace(/\D+/g, '');
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
    let rev = 11 - (sum % 11);
    if (rev === 10 || rev === 11) rev = 0;
    if (rev !== Number(cpf[9])) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
    rev = 11 - (sum % 11);
    if (rev === 10 || rev === 11) rev = 0;
    return rev === Number(cpf[10]);
  }

  /* ===================== USUÁRIOS, CARGOS HÍBRIDOS, AUTO-CADASTRO E APROVAÇÃO ===================== */
  function isUserAdmin(u) {
    if (!u) return false;
    if (u.isAdmin === true) return true;
    const rawRole = String(u.role || '').trim().toLowerCase();
    const rawSub = String(u.subRole || '').trim().toLowerCase();
    return rawRole === 'admin' || rawSub === 'admin' || /_admin$/.test(rawRole) || /_admin$/.test(rawSub);
  }

  function getUserSubRole(u) {
    if (!u) return 'condutor';
    const rawRole = String(u.role || 'condutor').trim().toLowerCase();
    const rawSub = String(u.subRole || '').trim().toLowerCase();

    if (rawRole === 'condutor_admin' || rawSub === 'condutor_admin') return 'condutor';
    if (rawRole === 'enfermeiro_admin' || rawSub === 'enfermeiro_admin') return 'enfermeiro';
    if (rawRole === 'tecnico_admin' || rawSub === 'tecnico_admin') return 'tecnico';

    if (rawSub === 'condutor') return 'condutor';
    if (rawSub === 'enfermeiro' || rawSub === 'enfermeira') return 'enfermeiro';
    if (rawSub === 'tecnico') return 'tecnico';

    if (rawRole === 'admin') return 'admin';
    if (rawRole === 'condutor') return 'condutor';
    if (rawRole === 'enfermeiro' || rawRole === 'enfermeira') return 'enfermeiro';

    const coren = String(u.coren || u.councilId || '');
    const name = String(u.name || '');
    if (String(u.username || '').toLowerCase() === 'enfermeiro' || /-\s*ENF\b/i.test(coren) || /\benfermeir[oa]\b/i.test(name)) {
      return 'enfermeiro';
    }
    return 'tecnico';
  }

  function hasOperationalRole(u) {
    if (!u) return false;
    const sub = getUserSubRole(u);
    return sub === 'condutor' || sub === 'enfermeiro' || sub === 'tecnico';
  }

  function getUserProfileChoice(u) {
    const adm = isUserAdmin(u);
    const sub = getUserSubRole(u);
    if (sub === 'admin') return 'admin';
    if (sub === 'condutor') return adm ? 'condutor_admin' : 'condutor';
    if (sub === 'enfermeiro') return adm ? 'enfermeiro_admin' : 'enfermeiro';
    return adm ? 'tecnico_admin' : 'tecnico';
  }

  function mapProfileChoiceToFields(choiceVal) {
    const c = String(choiceVal || 'tecnico').trim().toLowerCase();
    if (c === 'condutor_admin') return { role: 'condutor', subRole: 'condutor', isAdmin: true };
    if (c === 'enfermeiro_admin') return { role: 'enfermagem', subRole: 'enfermeiro', isAdmin: true };
    if (c === 'tecnico_admin') return { role: 'enfermagem', subRole: 'tecnico', isAdmin: true };
    if (c === 'admin') return { role: 'admin', subRole: 'admin', isAdmin: true };
    if (c === 'condutor') return { role: 'condutor', subRole: 'condutor', isAdmin: false };
    if (c === 'enfermeiro') return { role: 'enfermagem', subRole: 'enfermeiro', isAdmin: false };
    return { role: 'enfermagem', subRole: 'tecnico', isAdmin: false };
  }

  function getUserRoleLabel(u) {
    const choice = getUserProfileChoice(u);
    if (choice === 'condutor_admin') return 'Condutor Socorrista + ADM';
    if (choice === 'enfermeiro_admin') return 'Enfermeiro(a) + ADM';
    if (choice === 'tecnico_admin') return 'Téc. de Enfermagem + ADM';
    if (choice === 'admin') return 'Coordenação / ADM';
    if (choice === 'condutor') return 'Condutor Socorrista';
    if (choice === 'enfermeiro') return 'Enfermeiro(a)';
    return 'Téc. de Enfermagem';
  }

  function getUserRoleIcon(u) {
    const choice = getUserProfileChoice(u);
    if (choice === 'condutor_admin') return '🚑🔑';
    if (choice === 'enfermeiro_admin') return '👩‍⚕️🔑';
    if (choice === 'tecnico_admin') return '🩺🔑';
    if (choice === 'admin') return '🔑';
    if (choice === 'condutor') return '🚑';
    if (choice === 'enfermeiro') return '👩‍⚕️';
    return '🩺';
  }

  function normalizeUserObj(u) {
    const uname = String((u && u.username) || '').trim().toLowerCase();
    const mapped = mapProfileChoiceToFields(getUserProfileChoice(u));
    const role = mapped.role;
    const subRole = mapped.subRole;
    const isAdminFlag = Boolean(mapped.isAdmin);

    let corenVal = String((u && (u.coren || (role === 'enfermagem' ? u.councilId : ''))) || '').trim();
    if (uname === 'enfermagem' && (!corenVal || corenVal === 'COREN-SP')) {
      corenVal = 'COREN-SP 542.810-TE';
    }
    if (uname === 'enfermeiro' && !corenVal) {
      corenVal = 'COREN-SP 318.420-ENF';
    }
    const councilVal = role === 'enfermagem'
      ? (corenVal || String((u && u.councilId) || '').trim())
      : String((u && u.councilId) || '').trim();

    let status = u && u.status ? String(u.status) : '';
    if (!status) {
      status = (u && u.active === false) ? 'pending' : 'approved';
    }
    const isApproved = status === 'approved' && (u ? u.active !== false : true);
    const rawCpf = String((u && u.cpf) || '').replace(/\D+/g, '');

    return {
      username: uname,
      password: String((u && u.password) || '1234'),
      name: String((u && u.name) || uname),
      role: role,
      subRole: subRole,
      isAdmin: isAdminFlag,
      cpf: rawCpf.length === 11 ? formatCpf(rawCpf) : String((u && u.cpf) || '').trim(),
      coren: role === 'enfermagem' ? corenVal : '',
      councilId: councilVal,
      savedSignature: String((u && u.savedSignature) || '').trim(),
      status: status,
      active: isApproved,
      requestedAt: (u && u.requestedAt) || '',
      approvedAt: (u && u.approvedAt) || '',
      approvedBy: (u && u.approvedBy) || '',
      updatedAt: (u && u.updatedAt) || '2026-01-01T00:00:00.000Z'
    };
  }

  function getDeletedUsersMap() {
    try {
      const raw = safeLS.getItem(LS_DELETED_USERS);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function setDeletedUsersMap(mapObj) {
    saveInternalJson(LS_DELETED_USERS, mapObj || {});
  }

  function getLocalUsers() {
    try {
      const raw = safeLS.getItem(LS_USERS);
      if (!raw) {
        const seeded = DEFAULT_USERS.map(normalizeUserObj);
        saveInternalJson(LS_USERS, seeded);
        safeLS.setItem(LS_SEED_V2_DONE, '1');
        return seeded;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.length) {
        const seeded = DEFAULT_USERS.map(normalizeUserObj);
        saveInternalJson(LS_USERS, seeded);
        safeLS.setItem(LS_SEED_V2_DONE, '1');
        return seeded;
      }
      const list = parsed.map(normalizeUserObj);
      if (!safeLS.getItem(LS_SEED_V2_DONE)) {
        const delMap = getDeletedUsersMap();
        let addedAny = false;
        DEFAULT_USERS.forEach(defU => {
          const uname = defU.username.toLowerCase();
          if (!delMap[uname] && !list.some(x => x.username === uname)) {
            list.push(normalizeUserObj(defU));
            addedAny = true;
          }
        });
        safeLS.setItem(LS_SEED_V2_DONE, '1');
        if (addedAny) saveInternalJson(LS_USERS, list);
      }
      return list;
    } catch (e) {
      return DEFAULT_USERS.map(normalizeUserObj);
    }
  }

  function setLocalUsers(users) {
    const clean = (Array.isArray(users) ? users : []).map(normalizeUserObj).filter(u => Boolean(u.username));
    saveInternalJson(LS_USERS, clean);
    return clean;
  }

  function upsertLocalUser(userObj, skipDirty) {
    const users = getLocalUsers();
    const uname = String((userObj && userObj.username) || '').trim().toLowerCase();
    if (!uname) return users;
    const now = new Date().toISOString();
    const idx = users.findIndex(u => u.username.toLowerCase() === uname);

    if (idx >= 0) {
      const merged = Object.assign({}, users[idx], userObj, {
        username: uname,
        password: (userObj.password && String(userObj.password).trim() !== '') ? String(userObj.password) : users[idx].password,
        updatedAt: userObj.updatedAt || now
      });
      users[idx] = normalizeUserObj(merged);
    } else {
      users.push(normalizeUserObj(Object.assign({}, userObj, {
        username: uname,
        updatedAt: userObj.updatedAt || now
      })));
    }

    // Se o usuário foi recriado/atualizado, tira da lista de excluídos
    const delMap = getDeletedUsersMap();
    if (delMap[uname]) {
      delete delMap[uname];
      setDeletedUsersMap(delMap);
    }

    setLocalUsers(users);
    if (!skipDirty) markGitHubDirty();
    return users;
  }

  function deleteLocalUser(username, skipDirty) {
    const uname = String(username || '').trim().toLowerCase();
    if (!uname) return getLocalUsers();
    const nowIso = new Date().toISOString();
    const users = getLocalUsers().filter(u => u.username.toLowerCase() !== uname);
    setLocalUsers(users);
    const delMap = getDeletedUsersMap();
    delMap[uname] = nowIso;
    setDeletedUsersMap(delMap);

    // Desativa equipes ativas do plantão que tinham este usuário excluído
    try {
      const crewsMap = getCrewTeamsMap();
      let crewsTouched = false;
      Object.keys(crewsMap).forEach(cid => {
        const c = crewsMap[cid];
        if (c && c.active !== false && Array.isArray(c.members) && c.members.some(m => String(m).toLowerCase() === uname)) {
          crewsMap[cid] = Object.assign({}, c, { active: false, updatedAt: nowIso });
          crewsTouched = true;
        }
      });
      if (crewsTouched) setCrewTeamsMap(crewsMap);
    } catch (e) {}

    if (!skipDirty) markGitHubDirty();
    return users;
  }

  function getPendingUsers() {
    return getLocalUsers().filter(u => u.status === 'pending');
  }

  async function registerUserRequest(form) {
    const rawRole = String(form.role || 'condutor').trim().toLowerCase();
    const role = (rawRole === 'enfermagem' || rawRole === 'enfermeiro') ? 'enfermagem' : 'condutor';
    const rawSubRole = String(form.subRole || '').trim().toLowerCase();
    const subRole = role === 'condutor'
      ? 'condutor'
      : ((rawSubRole === 'enfermeiro' || rawRole === 'enfermeiro') ? 'enfermeiro' : 'tecnico');
    const name = String(form.name || '').trim();
    const username = String(form.username || '').trim().toLowerCase().replace(/\s+/g, '');
    const password = String(form.password || '').trim();
    const cpfDigits = String(form.cpf || '').replace(/\D+/g, '');
    const coren = role === 'enfermagem' ? String(form.coren || '').trim() : '';

    if (!name) throw new Error('Informe seu Nome Completo.');
    if (username.length < 3) throw new Error('O Login deve ter pelo menos 3 caracteres (sem espaços).');
    if (password.length < 3) throw new Error('A Senha deve ter pelo menos 3 caracteres.');
    if (role === 'enfermagem' && !coren) throw new Error('Informe o seu número de COREN.');
    if (cpfDigits.length !== 11 || !isValidCpf(cpfDigits)) {
      throw new Error('Informe um CPF válido com 11 dígitos.');
    }

    // Se tiver internet e GitHub configurado, consulta antes para evitar duplicidade
    if (navigator.onLine && hasGitHubConfigured()) {
      try { await syncInternalDbWithGitHub({ pushChanges: false }); } catch (e) {}
    }

    const existingUsers = getLocalUsers();
    const sameLogin = existingUsers.find(u => u.username.toLowerCase() === username);
    if (sameLogin) {
      if (sameLogin.status === 'pending') {
        throw new Error('Este login já foi enviado e está aguardando aprovação do Administrador.');
      }
      throw new Error('Este login já existe no sistema. Escolha outro login ou entre na sua conta.');
    }

    const sameCpf = existingUsers.find(u => String(u.cpf || '').replace(/\D+/g, '') === cpfDigits);
    if (sameCpf) {
      if (sameCpf.status === 'pending') {
        throw new Error(`Este CPF já possui solicitação pendente (login: "${sameCpf.username}"). Aguarde a aprovação do Adm.`);
      }
      throw new Error(`Este CPF já está cadastrado no login "${sameCpf.username}".`);
    }

    const now = new Date().toISOString();
    const newUser = normalizeUserObj({
      username,
      password,
      name,
      role,
      subRole,
      cpf: formatCpf(cpfDigits),
      coren,
      councilId: coren,
      status: 'pending',
      active: false,
      requestedAt: now,
      updatedAt: now
    });

    upsertLocalUser(newUser, false);

    let githubSynced = false;
    if (navigator.onLine && hasGitHubConfigured()) {
      try {
        const ghRes = await syncInternalDbWithGitHub({ pushChanges: true });
        githubSynced = Boolean(ghRes && ghRes.pushed);
      } catch (e) {}
    }

    return { ok: true, user: newUser, githubSynced };
  }

  async function approveUser(username, overrides, adminUsername) {
    const uname = String(username || '').trim().toLowerCase();
    const users = getLocalUsers();
    const target = users.find(u => u.username.toLowerCase() === uname);
    if (!target) throw new Error('Cadastro não encontrado na base interna.');

    const now = new Date().toISOString();
    const updated = Object.assign({}, target, overrides || {}, {
      status: 'approved',
      active: true,
      approvedAt: now,
      approvedBy: adminUsername || 'admin',
      updatedAt: now
    });
    if (updated.role === 'enfermagem' && updated.coren) {
      updated.councilId = updated.coren;
    }
    upsertLocalUser(updated, false);

    // Sincroniza imediatamente com GitHub e/ou Google Apps Script se houver internet
    let githubSynced = false;
    if (navigator.onLine && hasGitHubConfigured()) {
      try {
        const ghRes = await syncInternalDbWithGitHub({ pushChanges: true });
        githubSynced = Boolean(ghRes && ghRes.pushed);
      } catch (e) {}
    }

    const settings = getSettings();
    const sess = getSession();
    if (navigator.onLine && settings.scriptUrl && sess && isUserAdmin(sess)) {
      try {
        await apiPost({
          action: 'saveUser',
          authUser: sess.username,
          authPass: sess.password,
          authName: sess.name || sess.username,
          authRole: getUserProfileChoice(sess),
          userData: Object.assign({}, updated, { role: getUserProfileChoice(updated) })
        });
      } catch (e) {}
    }

    return { ok: true, user: normalizeUserObj(updated), githubSynced };
  }

  async function rejectUser(username) {
    deleteLocalUser(username, false);
    if (navigator.onLine && hasGitHubConfigured()) {
      try { await syncInternalDbWithGitHub({ pushChanges: true }); } catch (e) {}
    }
    const settings = getSettings();
    const sess = getSession();
    if (navigator.onLine && settings.scriptUrl && sess && isUserAdmin(sess)) {
      try {
        await apiPost({
          action: 'deleteUser',
          authUser: sess.username,
          authPass: sess.password,
          authName: sess.name || sess.username,
          authRole: getUserProfileChoice(sess),
          username
        });
      } catch (e) {}
    }
    return { ok: true };
  }

  /* ===================== RECEBEDORES DO HOSPITAL (NOME + COREN/CRM SALVOS) ===================== */
  function normKey(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function getHospitalReceivers() {
    try {
      const raw = safeLS.getItem(LS_HOSP_RECEIVERS);
      const list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return list;
    } catch (e) {
      return [];
    }
  }

  function setHospitalReceivers(list) {
    const clean = Array.isArray(list) ? list : [];
    saveInternalJson(LS_HOSP_RECEIVERS, clean);
    return clean;
  }

  function upsertHospitalReceiver(info, skipDirty) {
    const nome = String((info && info.nome) || '').trim();
    const corenCrm = String((info && info.corenCrm) || '').trim();
    const hospital = String((info && info.hospital) || 'HBSA').trim() || 'HBSA';
    if (!nome) return getHospitalReceivers();

    const id = normKey(nome);
    if (!id) return getHospitalReceivers();

    const list = getHospitalReceivers();
    const now = new Date().toISOString();
    const idx = list.findIndex(item => (item.id || normKey(item.nome)) === id);

    if (idx >= 0) {
      list[idx] = {
        id,
        nome,
        corenCrm: corenCrm || list[idx].corenCrm || '',
        hospital: hospital || list[idx].hospital || 'HBSA',
        useCount: (Number(list[idx].useCount) || 1) + 1,
        updatedAt: (info && info.updatedAt) || now
      };
    } else {
      list.unshift({
        id,
        nome,
        corenCrm,
        hospital,
        useCount: 1,
        updatedAt: (info && info.updatedAt) || now
      });
    }

    setHospitalReceivers(list);
    if (!skipDirty) {
      markGitHubDirty();
      if (navigator.onLine && hasGitHubConfigured() && getSettings().githubToken) {
        syncInternalDbWithGitHub({ pushChanges: true }).catch(() => {});
      }
    }
    return getHospitalReceivers();
  }

  function deleteHospitalReceiver(id) {
    const list = getHospitalReceivers().filter(item => item.id !== id);
    setHospitalReceivers(list);
    markGitHubDirty();
    if (navigator.onLine && hasGitHubConfigured() && getSettings().githubToken) {
      syncInternalDbWithGitHub({ pushChanges: true }).catch(() => {});
    }
    return list;
  }

  /* ===================== MÉDICOS REGULADORES SALVOS AUTOMATICAMENTE ===================== */
  function extractCleanMedicoName(rawText) {
    const raw = String(rawText || '').trim();
    if (!raw) return '';
    // Se a equipe digitou "Dr. João / Senha 1234", salva apenas o nome/CRM do médico ("Dr. João") sem a senha única da ocorrência
    const cleaned = raw.replace(/\s*(?:[\/\-–|]\s*)?\bsenha\b[\s:#\-]*[a-z0-9.\-/]*$/i, '').trim();
    if (!cleaned || cleaned.length < 2) return '';
    return cleaned;
  }

  function getMedicosReguladores() {
    try {
      const raw = safeLS.getItem(LS_MEDICOS_REGULADORES);
      const list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return list;
    } catch (e) {
      return [];
    }
  }

  function setMedicosReguladores(list) {
    const clean = Array.isArray(list) ? list : [];
    saveInternalJson(LS_MEDICOS_REGULADORES, clean);
    return clean;
  }

  function upsertMedicoRegulador(info, skipDirty) {
    const rawNome = typeof info === 'string' ? info : ((info && info.nome) || '');
    const nome = extractCleanMedicoName(rawNome);
    if (!nome) return getMedicosReguladores();

    const id = normKey(nome);
    if (!id) return getMedicosReguladores();

    const list = getMedicosReguladores();
    const now = new Date().toISOString();
    const idx = list.findIndex(item => (item.id || normKey(item.nome)) === id);

    if (idx >= 0) {
      list[idx] = {
        id,
        nome,
        useCount: (Number(list[idx].useCount) || 1) + 1,
        updatedAt: (info && typeof info === 'object' && info.updatedAt) || now
      };
    } else {
      list.unshift({
        id,
        nome,
        useCount: 1,
        updatedAt: (info && typeof info === 'object' && info.updatedAt) || now
      });
    }

    setMedicosReguladores(list);
    if (!skipDirty) {
      markGitHubDirty();
      if (navigator.onLine && hasGitHubConfigured() && getSettings().githubToken) {
        syncInternalDbWithGitHub({ pushChanges: true }).catch(() => {});
      }
    }
    return getMedicosReguladores();
  }

  function deleteMedicoRegulador(id) {
    const list = getMedicosReguladores().filter(item => item.id !== id);
    setMedicosReguladores(list);
    markGitHubDirty();
    if (navigator.onLine && hasGitHubConfigured() && getSettings().githubToken) {
      syncInternalDbWithGitHub({ pushChanges: true }).catch(() => {});
    }
    return list;
  }

  /* ===================== AVARIAS SALVAS POR VIATURA (AMASSADOS / RISCADOS PERSISTENTES) ===================== */
  function getViaturaStorageKey(viaturaId, outraPlaca) {
    const vid = String(viaturaId || 'master_29').trim().toLowerCase() || 'master_29';
    if (vid === 'outra') {
      const nk = normKey(outraPlaca);
      return nk ? ('outra__' + nk) : 'outra';
    }
    return vid;
  }

  function sanitizeAvariasList(marks) {
    if (!Array.isArray(marks)) return [];
    return marks
      .filter(m => m && typeof m === 'object')
      .map(m => ({
        x: Math.max(0.01, Math.min(0.99, Number(m.x) || 0.5)),
        y: Math.max(0.01, Math.min(0.99, Number(m.y) || 0.5)),
        code: String(m.code || 'D').trim().toUpperCase() || 'D'
      }));
  }

  function getViaturaAvariasMap() {
    try {
      const raw = safeLS.getItem(LS_VIATURA_AVARIAS);
      const map = raw ? JSON.parse(raw) : {};
      return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    } catch (e) {
      return {};
    }
  }

  function setViaturaAvariasMap(mapObj) {
    saveInternalJson(LS_VIATURA_AVARIAS, mapObj || {});
    return mapObj;
  }

  function getViaturaAvarias(viaturaId, outraPlaca) {
    const map = getViaturaAvariasMap();
    const key = getViaturaStorageKey(viaturaId, outraPlaca);
    const entry = map[key];
    if (!entry || !Array.isArray(entry.marks)) return [];
    return sanitizeAvariasList(entry.marks);
  }

  function saveViaturaAvarias(viaturaId, outraPlaca, marks, updatedBy, skipDirty) {
    const map = getViaturaAvariasMap();
    const key = getViaturaStorageKey(viaturaId, outraPlaca);
    const cleanMarks = sanitizeAvariasList(marks);
    map[key] = {
      key,
      viaturaId: String(viaturaId || 'master_29').trim(),
      outraPlaca: String(outraPlaca || '').trim(),
      marks: cleanMarks,
      updatedAt: new Date().toISOString(),
      updatedBy: String(updatedBy || '').trim()
    };
    setViaturaAvariasMap(map);
    if (!skipDirty) {
      markGitHubDirty();
      if (navigator.onLine && hasGitHubConfigured() && getSettings().githubToken) {
        syncInternalDbWithGitHub({ pushChanges: true }).catch(() => {});
      }
    }
    return cleanMarks;
  }

  /* ===================== BASE INTERNA DE PACIENTES (OFFLINE + GITHUB) ===================== */
  function getInternalPatientsMap() {
    try {
      const raw = safeLS.getItem(LS_PATIENTS_DB);
      const map = raw ? JSON.parse(raw) : {};
      return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    } catch (e) {
      return {};
    }
  }

  function setInternalPatientsMap(mapObj) {
    saveInternalJson(LS_PATIENTS_DB, mapObj || {});
    return mapObj;
  }

  function upsertPatientInInternalDb(fichaData, skipDirty) {
    if (!fichaData) return;
    const cpf11 = String(fichaData.vitimaCpf || '').replace(/\D+/g, '');
    const nome = String(fichaData.vitimaNome || '').trim();
    if (cpf11.length !== 11 || !nome) return;

    const map = getInternalPatientsMap();
    const prev = map[cpf11] || {};
    const now = new Date().toISOString();

    map[cpf11] = {
      vitimaNome: nome,
      vitimaCpf: formatCpf(cpf11),
      vitimaRg: fichaData.vitimaRg || prev.vitimaRg || '',
      vitimaCns: fichaData.vitimaCns || prev.vitimaCns || '',
      vitimaDn: fichaData.vitimaDn || prev.vitimaDn || '',
      vitimaIdade: fichaData.vitimaIdade || prev.vitimaIdade || '',
      vitimaCep: fichaData.vitimaCep || prev.vitimaCep || '',
      vitimaCidade: fichaData.vitimaCidade || prev.vitimaCidade || 'Orlândia',
      vitimaBairro: fichaData.vitimaBairro || prev.vitimaBairro || '',
      vitimaEndereco: fichaData.vitimaEndereco || prev.vitimaEndereco || '',
      vitimaNumero: fichaData.vitimaNumero || prev.vitimaNumero || '',
      vitimaNaturalidade: fichaData.vitimaNaturalidade || prev.vitimaNaturalidade || '',
      vitimaPai: fichaData.vitimaPai || prev.vitimaPai || '',
      vitimaMae: fichaData.vitimaMae || prev.vitimaMae || '',
      antecedentes: (Array.isArray(fichaData.antecedentes) && fichaData.antecedentes.length) ? fichaData.antecedentes : (prev.antecedentes || []),
      medicamentosSelecionados: (Array.isArray(fichaData.medicamentosSelecionados) && fichaData.medicamentosSelecionados.length) ? fichaData.medicamentosSelecionados : (prev.medicamentosSelecionados || []),
      medicamentosOutro: fichaData.medicamentosOutro || prev.medicamentosOutro || '',
      alergiasSelecionadas: (Array.isArray(fichaData.alergiasSelecionadas) && fichaData.alergiasSelecionadas.length) ? fichaData.alergiasSelecionadas : (prev.alergiasSelecionadas || []),
      alergiasOutro: fichaData.alergiasOutro || prev.alergiasOutro || '',
      updatedAt: fichaData.updatedAt || now
    };

    setInternalPatientsMap(map);
    if (!skipDirty) markGitHubDirty();
  }

  /* ===================== CONSULTA E SINCRONIZAÇÃO COM BASE NO GITHUB ===================== */
  function utf8ToB64(str) {
    return window.btoa(unescape(encodeURIComponent(str)));
  }

  function b64ToUtf8(b64) {
    return decodeURIComponent(escape(window.atob(String(b64 || '').replace(/\s+/g, ''))));
  }

  async function genericHttpJson(method, url, headersObj, bodyStr) {
    if (window.AndroidBridge && typeof window.AndroidBridge.httpRequest === 'function') {
      return new Promise((resolve, reject) => {
        const reqId = 'http_' + (nativeReqCounter++) + '_' + Date.now();
        pendingNativeCalls[reqId] = { resolve, reject };
        try {
          window.AndroidBridge.httpRequest(
            reqId,
            method,
            url,
            headersObj ? JSON.stringify(headersObj) : '',
            bodyStr || ''
          );
        } catch (err) {
          delete pendingNativeCalls[reqId];
          reject(err);
        }
      });
    }

    const opts = {
      method,
      headers: headersObj || {},
      cache: 'no-store'
    };
    if (bodyStr && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      opts.body = bodyStr;
    }
    const resp = await fetch(url, opts);
    const txt = await resp.text();
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 180)}`);
    }
    return txt ? JSON.parse(txt) : {};
  }

  async function genericHttpText(method, url, headersObj) {
    if (window.AndroidBridge && typeof window.AndroidBridge.httpRequest === 'function') {
      return new Promise((resolve, reject) => {
        const reqId = 'httptxt_' + (nativeReqCounter++) + '_' + Date.now();
        pendingNativeCalls[reqId] = { resolve, reject, rawText: true };
        try {
          window.AndroidBridge.httpRequest(
            reqId,
            method,
            url,
            headersObj ? JSON.stringify(headersObj) : '',
            ''
          );
        } catch (err) {
          delete pendingNativeCalls[reqId];
          reject(err);
        }
      });
    }
    const resp = await fetch(url, { method, headers: headersObj || {}, cache: 'no-store' });
    const txt = await resp.text();
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 180)}`);
    }
    return txt;
  }

  function parseGitHubConfig(customSettings) {
    const s = customSettings || getSettings();
    const rawInput = String(s.githubRepo || '').trim();
    if (!rawInput) return null;

    const branch = String(s.githubBranch || 'main').trim() || 'main';
    const filePath = String(s.githubFilePath || 'base_dados_samu.json').trim().replace(/^\/+/, '') || 'base_dados_samu.json';
    const token = String(s.githubToken || '').trim();

    // Caso 1: URL direta raw.githubusercontent.com
    const rawMatch = rawInput.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i);
    if (rawMatch) {
      return {
        owner: rawMatch[1],
        repo: rawMatch[2],
        branch: rawMatch[3],
        path: rawMatch[4].split('?')[0],
        token,
        rawUrl: rawInput.split('?')[0]
      };
    }

    // Caso 2: URL github.com/owner/repo(/blob/branch/path)
    const ghMatch = rawInput.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/(?:blob|tree)\/([^/]+)(?:\/(.+))?)?/i);
    if (ghMatch) {
      const ow = ghMatch[1];
      const rp = ghMatch[2].replace(/\.git$/i, '');
      const br = ghMatch[3] || branch;
      const pt = ghMatch[4] || filePath;
      return {
        owner: ow,
        repo: rp,
        branch: br,
        path: pt,
        token,
        rawUrl: `https://raw.githubusercontent.com/${ow}/${rp}/${br}/${pt}`
      };
    }

    // Caso 3: Outra URL JSON direta (ex: GitHub Gist Raw)
    if (/^https?:\/\//i.test(rawInput)) {
      return {
        owner: '',
        repo: '',
        branch,
        path: filePath,
        token,
        rawUrl: rawInput
      };
    }

    // Caso 4: Formato curto "usuario/repositorio"
    const parts = rawInput.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length >= 2) {
      const ow = parts[0];
      const rp = parts[1].replace(/\.git$/i, '');
      const pt = parts.length > 2 ? parts.slice(2).join('/') : filePath;
      return {
        owner: ow,
        repo: rp,
        branch,
        path: pt,
        token,
        rawUrl: `https://raw.githubusercontent.com/${ow}/${rp}/${branch}/${pt}`
      };
    }

    return null;
  }

  function hasGitHubConfigured() {
    return Boolean(parseGitHubConfig());
  }

  /* ===================== EQUIPES DO PLANTÃO (ATÉ 3 MEMBROS) E FICHAS COMPARTILHADAS ===================== */
  function getCrewTeamsMap() {
    try {
      const raw = safeLS.getItem(LS_CREW_TEAMS);
      const map = raw ? JSON.parse(raw) : {};
      return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    } catch (e) {
      return {};
    }
  }

  function setCrewTeamsMap(mapObj) {
    saveInternalJson(LS_CREW_TEAMS, mapObj || {});
    return mapObj;
  }

  function computeCrewId(usernames) {
    const clean = Array.from(new Set(
      (Array.isArray(usernames) ? usernames : [])
        .map(u => String(u || '').trim().toLowerCase())
        .filter(Boolean)
    )).sort();
    return 'crew__' + clean.join('__');
  }

  function validateCrewSelection(memberUsers) {
    const list = (Array.isArray(memberUsers) ? memberUsers : []).filter(Boolean);
    const total = list.length;
    let drivers = 0;
    let tecnicos = 0;
    let enfermeiros = 0;

    list.forEach(u => {
      const sub = getUserSubRole(u);
      if (sub === 'condutor') drivers++;
      else if (sub === 'enfermeiro') enfermeiros++;
      else if (sub === 'tecnico') tecnicos++;
    });
    const nursingTotal = tecnicos + enfermeiros;

    if (total < 2) {
      return {
        valid: false,
        drivers,
        tecnicos,
        enfermeiros,
        message: 'Selecione com quem você está trabalhando no plantão (2 ou até 3 integrantes).'
      };
    }
    if (total > 3) {
      return {
        valid: false,
        drivers,
        tecnicos,
        enfermeiros,
        message: 'A equipe pode ter no máximo 3 integrantes no plantão.'
      };
    }
    if (drivers < 1) {
      return {
        valid: false,
        drivers,
        tecnicos,
        enfermeiros,
        message: 'A equipe precisa ter pelo menos 1 Condutor Socorrista.'
      };
    }
    if (nursingTotal < 1) {
      return {
        valid: false,
        drivers,
        tecnicos,
        enfermeiros,
        message: 'A equipe precisa ter pelo menos 1 Téc. de Enfermagem ou Enfermeiro(a).'
      };
    }

    if (total === 2) {
      if (drivers === 1 && nursingTotal === 1) {
        const nurLabel = enfermeiros === 1 ? '1 Enfermeiro(a)' : '1 Téc. Enfermagem';
        return {
          valid: true,
          drivers,
          tecnicos,
          enfermeiros,
          message: `✅ Equipe válida (2 integrantes): 1 Condutor + ${nurLabel}.`
        };
      }
      return {
        valid: false,
        drivers,
        tecnicos,
        enfermeiros,
        message: 'Em dupla, selecione 1 Condutor Socorrista + 1 profissional de Enfermagem.'
      };
    }

    // total === 3
    if (drivers === 2 && nursingTotal === 1) {
      const nurLabel = enfermeiros === 1 ? '1 Enfermeiro(a)' : '1 Téc. Enfermagem';
      return {
        valid: true,
        drivers,
        tecnicos,
        enfermeiros,
        message: `✅ Equipe válida (3 integrantes): 2 Condutores + ${nurLabel}.`
      };
    }
    if (drivers === 1 && tecnicos === 1 && enfermeiros === 1) {
      return {
        valid: true,
        drivers,
        tecnicos,
        enfermeiros,
        message: '✅ Equipe válida (3 integrantes): 1 Téc. Enfermagem + 1 Enfermeiro(a) + 1 Condutor.'
      };
    }

    return {
      valid: false,
      drivers,
      tecnicos,
      enfermeiros,
      message: 'Em 3 integrantes, a equipe deve ser: (2 Condutores + 1 Téc./Enfermeiro) OU (1 Téc. Enfermagem + 1 Enfermeiro(a) + 1 Condutor).'
    };
  }

  function hydrateCrewRecord(rawCrew, perspectiveUsername) {
    if (!rawCrew || !Array.isArray(rawCrew.members) || rawCrew.members.length < 2) return null;
    const allUsers = getLocalUsers();
    const byUname = new Map();
    allUsers.forEach(u => byUname.set(u.username.toLowerCase(), u));

    const membersDetailed = rawCrew.members.map(uname => {
      const key = String(uname || '').trim().toLowerCase();
      const found = byUname.get(key);
      const uObj = found || normalizeUserObj({ username: key, name: key, role: 'condutor' });
      const subRole = getUserSubRole(uObj);
      return {
        username: uObj.username,
        name: uObj.name,
        role: uObj.role,
        subRole,
        roleLabel: getUserRoleLabel(uObj),
        coren: uObj.role === 'enfermagem' ? (uObj.coren || uObj.councilId || '') : '',
        savedSignature: getSavedSignature(uObj.username) || uObj.savedSignature || ''
      };
    });

    // Ordem determinística para que todos os celulares preencham exatamente o mesmo Slot 1 e Slot 2
    const nursingSlots = membersDetailed
      .filter(m => m.role === 'enfermagem')
      .sort((a, b) => {
        const rankA = a.subRole === 'enfermeiro' ? 0 : 1;
        const rankB = b.subRole === 'enfermeiro' ? 0 : 1;
        if (rankA !== rankB) return rankA - rankB;
        return a.username.localeCompare(b.username);
      });

    const driverSlots = membersDetailed
      .filter(m => m.role === 'condutor')
      .sort((a, b) => a.username.localeCompare(b.username));

    const meLower = String(perspectiveUsername || '').trim().toLowerCase();
    const teammates = meLower
      ? membersDetailed.filter(m => m.username !== meLower)
      : membersDetailed.slice();

    return {
      crewId: rawCrew.crewId || computeCrewId(rawCrew.members),
      members: membersDetailed.map(m => m.username),
      membersDetailed,
      teammates,
      nursingSlots,
      driverSlots,
      active: rawCrew.active !== false,
      createdBy: rawCrew.createdBy || '',
      updatedBy: rawCrew.updatedBy || '',
      updatedAt: rawCrew.updatedAt || ''
    };
  }

  function getActiveCrewForUser(username) {
    const uname = String(username || '').trim().toLowerCase();
    if (!uname) return null;
    const map = getCrewTeamsMap();
    let best = null;
    Object.keys(map).forEach(cid => {
      const c = map[cid];
      if (!c || c.active === false || !Array.isArray(c.members)) return;
      if (!c.members.map(x => String(x).toLowerCase()).includes(uname)) return;
      if (!best || String(c.updatedAt || '') >= String(best.updatedAt || '')) {
        best = c;
      }
    });
    return best ? hydrateCrewRecord(best, uname) : null;
  }

  function getSharedFichasMap() {
    try {
      const raw = safeLS.getItem(LS_SHARED_FICHAS);
      const map = raw ? JSON.parse(raw) : {};
      return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    } catch (e) {
      return {};
    }
  }

  function setSharedFichasMap(mapObj) {
    saveInternalJson(LS_SHARED_FICHAS, mapObj || {});
    return mapObj;
  }

  function ensureCrewWorkspaceShape(crewId, rawWs) {
    const ws = (rawWs && typeof rawWs === 'object') ? rawWs : {};
    return {
      crewId: String(crewId || ws.crewId || ''),
      updatedAt: ws.updatedAt || new Date().toISOString(),
      lastKmFinal: String(ws.lastKmFinal || ''),
      lastKmUpdatedAt: String(ws.lastKmUpdatedAt || ''),
      currentFicha: (ws.currentFicha && typeof ws.currentFicha === 'object' && ws.currentFicha.data)
        ? ws.currentFicha
        : null,
      closedSessions: (ws.closedSessions && typeof ws.closedSessions === 'object') ? ws.closedSessions : {},
      draftRecords: (ws.draftRecords && typeof ws.draftRecords === 'object') ? ws.draftRecords : {},
      closedDraftIds: (ws.closedDraftIds && typeof ws.closedDraftIds === 'object') ? ws.closedDraftIds : {}
    };
  }

  function getCrewWorkspace(crewId) {
    if (!crewId) return null;
    const map = getSharedFichasMap();
    return ensureCrewWorkspaceShape(crewId, map[crewId]);
  }

  function isNonEmptyFichaValue(val) {
    if (val === null || val === undefined) return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') return Object.values(val).some(v => isNonEmptyFichaValue(v));
    if (typeof val === 'boolean') return val;
    return String(val).trim() !== '';
  }

  function hasMeaningfulFichaProgress(fichaData) {
    if (!fichaData || typeof fichaData !== 'object') return false;
    const checkKeys = [
      'numOcorrencia', 'motivoQueixa', 'vitimaNome', 'vitimaCpf', 'vitimaEndereco',
      'svPa', 'svFc', 'svSpo2', 'svDxt', 'relatorioEnfermagem', 'procedimentosTexto',
      'recebidoPorNome', 'sigHospital', 'sigPacienteRecusa'
    ];
    if (checkKeys.some(k => String(fichaData[k] || '').trim() !== '')) return true;
    if (Array.isArray(fichaData.tipoOcorrencia) && fichaData.tipoOcorrencia.length > 0) return true;
    if (fichaData.horarios && typeof fichaData.horarios === 'object') {
      const hKeys = ['horaChamado', 'saidaBase', 'chegadaLocal', 'saidaLocal', 'chegadaDestino', 'retornoBase'];
      if (hKeys.some(hk => String(fichaData.horarios[hk] || '').trim() !== '')) return true;
    }
    return false;
  }

  function mergeSharedFichaDocs(docA, docB, closedSessionsMap) {
    const closed = closedSessionsMap || {};
    const validA = (docA && docA.data && docA.sessionId && !closed[docA.sessionId]) ? docA : null;
    const validB = (docB && docB.data && docB.sessionId && !closed[docB.sessionId]) ? docB : null;

    if (!validA && !validB) return null;
    if (validA && !validB) return JSON.parse(JSON.stringify(validA));
    if (!validA && validB) return JSON.parse(JSON.stringify(validB));

    const aIsNewer = String(validA.updatedAt || '') >= String(validB.updatedAt || '');
    const newerDoc = aIsNewer ? validA : validB;
    const olderDoc = aIsNewer ? validB : validA;

    // Se um integrante abriu explicitamente um rascunho/registro salvo distinto, respeita o mais recente sem misturar registros diferentes
    if (
      validA.sessionId !== validB.sessionId &&
      (validA.isLoadedRecord || validB.isLoadedRecord) &&
      validA.recordId && validB.recordId && validA.recordId !== validB.recordId
    ) {
      return JSON.parse(JSON.stringify(newerDoc));
    }

    const tsMapA = (validA.fieldTs && typeof validA.fieldTs === 'object') ? validA.fieldTs : {};
    const tsMapB = (validB.fieldTs && typeof validB.fieldTs === 'object') ? validB.fieldTs : {};
    const mergedFieldTs = {};
    const mergedData = {};

    const allKeys = new Set([
      ...Object.keys(validA.data || {}),
      ...Object.keys(validB.data || {})
    ]);

    allKeys.forEach(k => {
      if (k === 'horarios') return;
      const tA = Number(tsMapA[k] || 0);
      const tB = Number(tsMapB[k] || 0);
      const valA = validA.data[k];
      const valB = validB.data[k];

      if (tB > tA) {
        mergedData[k] = valB !== undefined ? JSON.parse(JSON.stringify(valB)) : '';
        mergedFieldTs[k] = tB;
      } else if (tA > tB) {
        mergedData[k] = valA !== undefined ? JSON.parse(JSON.stringify(valA)) : '';
        mergedFieldTs[k] = tA;
      } else {
        if (tA > 0) mergedFieldTs[k] = tA;
        if (isNonEmptyFichaValue(valA) && !isNonEmptyFichaValue(valB)) {
          mergedData[k] = JSON.parse(JSON.stringify(valA));
        } else if (isNonEmptyFichaValue(valB) && !isNonEmptyFichaValue(valA)) {
          mergedData[k] = JSON.parse(JSON.stringify(valB));
        } else {
          const pick = aIsNewer ? valA : valB;
          mergedData[k] = pick !== undefined ? JSON.parse(JSON.stringify(pick)) : '';
        }
      }
    });

    // Mescla subcampos de horários individualmente (ex: Condutor preenche KM/Saída enquanto Téc. preenche outros campos)
    const horA = (validA.data && validA.data.horarios && typeof validA.data.horarios === 'object') ? validA.data.horarios : {};
    const horB = (validB.data && validB.data.horarios && typeof validB.data.horarios === 'object') ? validB.data.horarios : {};
    const mergedHor = {};
    const horKeys = new Set([...Object.keys(horA), ...Object.keys(horB)]);
    horKeys.forEach(hk => {
      const fk = 'horarios.' + hk;
      const tA = Number(tsMapA[fk] || 0);
      const tB = Number(tsMapB[fk] || 0);
      const vA = horA[hk];
      const vB = horB[hk];
      if (tB > tA) {
        mergedHor[hk] = vB !== undefined ? vB : '';
        mergedFieldTs[fk] = tB;
      } else if (tA > tB) {
        mergedHor[hk] = vA !== undefined ? vA : '';
        mergedFieldTs[fk] = tA;
      } else {
        if (tA > 0) mergedFieldTs[fk] = tA;
        if (isNonEmptyFichaValue(vA) && !isNonEmptyFichaValue(vB)) mergedHor[hk] = vA;
        else if (isNonEmptyFichaValue(vB) && !isNonEmptyFichaValue(vA)) mergedHor[hk] = vB;
        else mergedHor[hk] = (aIsNewer ? vA : vB) || '';
      }
    });
    mergedData.horarios = mergedHor;

    return {
      sessionId: newerDoc.sessionId || olderDoc.sessionId,
      recordId: newerDoc.recordId || olderDoc.recordId || '',
      isLoadedRecord: Boolean(newerDoc.isLoadedRecord || olderDoc.isLoadedRecord),
      updatedAt: newerDoc.updatedAt || new Date().toISOString(),
      updatedBy: newerDoc.updatedBy || olderDoc.updatedBy || '',
      updatedByName: newerDoc.updatedByName || olderDoc.updatedByName || '',
      fieldTs: mergedFieldTs,
      data: mergedData
    };
  }

  function pruneMapByTimestamp(mapObj, maxEntries, getTsFn) {
    const obj = (mapObj && typeof mapObj === 'object') ? mapObj : {};
    const entries = Object.entries(obj);
    if (entries.length <= maxEntries) return obj;
    entries.sort((a, b) => String(getTsFn(b[1]) || '').localeCompare(String(getTsFn(a[1]) || '')));
    const trimmed = {};
    entries.slice(0, maxEntries).forEach(([k, v]) => { trimmed[k] = v; });
    return trimmed;
  }

  function mergeCrewWorkspaces(wsA, wsB) {
    const a = ensureCrewWorkspaceShape((wsA && wsA.crewId) || (wsB && wsB.crewId) || '', wsA);
    const b = ensureCrewWorkspaceShape(a.crewId, wsB);

    const closedSessions = Object.assign({}, a.closedSessions);
    Object.keys(b.closedSessions).forEach(sid => {
      const ca = closedSessions[sid];
      const cb = b.closedSessions[sid];
      if (!ca || String((cb && cb.closedAt) || '') >= String((ca && ca.closedAt) || '')) {
        closedSessions[sid] = cb;
      }
    });

    const closedDraftIds = Object.assign({}, a.closedDraftIds);
    Object.keys(b.closedDraftIds).forEach(rid => {
      if (!closedDraftIds[rid] || String(b.closedDraftIds[rid]) > String(closedDraftIds[rid])) {
        closedDraftIds[rid] = b.closedDraftIds[rid];
      }
    });

    const draftRecords = {};
    const allDraftIds = new Set([...Object.keys(a.draftRecords), ...Object.keys(b.draftRecords)]);
    allDraftIds.forEach(rid => {
      const da = a.draftRecords[rid];
      const db = b.draftRecords[rid];
      const pick = (!da) ? db : ((!db) ? da : (String(db.updatedAt || db.createdAt || '') >= String(da.updatedAt || da.createdAt || '') ? db : da));
      if (!pick) return;
      const closedTs = closedDraftIds[rid];
      const pickTs = String(pick.updatedAt || pick.createdAt || '');
      if (closedTs && String(closedTs) >= pickTs) return;
      draftRecords[rid] = pick;
    });

    let lastKmFinal = a.lastKmFinal;
    let lastKmUpdatedAt = a.lastKmUpdatedAt;
    if (b.lastKmFinal && (!lastKmFinal || String(b.lastKmUpdatedAt || '') >= String(lastKmUpdatedAt || ''))) {
      lastKmFinal = b.lastKmFinal;
      lastKmUpdatedAt = b.lastKmUpdatedAt;
    }

    const mergedCurrent = mergeSharedFichaDocs(a.currentFicha, b.currentFicha, closedSessions);
    const updatedAt = String(b.updatedAt || '') > String(a.updatedAt || '') ? b.updatedAt : a.updatedAt;

    return {
      crewId: a.crewId,
      updatedAt: updatedAt || new Date().toISOString(),
      lastKmFinal,
      lastKmUpdatedAt,
      currentFicha: mergedCurrent,
      closedSessions: pruneMapByTimestamp(closedSessions, 40, v => v && v.closedAt),
      draftRecords: pruneMapByTimestamp(draftRecords, 25, v => v && (v.updatedAt || v.createdAt)),
      closedDraftIds: pruneMapByTimestamp(closedDraftIds, 50, v => v)
    };
  }

  function setActiveCrewForUsers(usernames, initiatorUsername) {
    const cleanNames = Array.from(new Set(
      (Array.isArray(usernames) ? usernames : [])
        .map(u => String(u || '').trim().toLowerCase())
        .filter(Boolean)
    )).sort();

    const allUsers = getLocalUsers();
    const memberUsers = cleanNames.map(un => allUsers.find(u => u.username.toLowerCase() === un)).filter(Boolean);
    if (memberUsers.length !== cleanNames.length) {
      throw new Error('Um ou mais integrantes selecionados não foram encontrados na base de usuários.');
    }

    const check = validateCrewSelection(memberUsers);
    if (!check.valid) {
      throw new Error(check.message);
    }

    const newCrewId = computeCrewId(cleanNames);
    const crewsMap = getCrewTeamsMap();
    const sharedMap = getSharedFichasMap();

    // Se algum integrante já estava com uma ficha em andamento em dupla e adicionou o 3º integrante, leva a ficha em andamento junto!
    let carryOverWs = null;
    cleanNames.forEach(un => {
      const prevCrew = getActiveCrewForUser(un);
      if (prevCrew && prevCrew.crewId !== newCrewId) {
        const pWs = sharedMap[prevCrew.crewId];
        if (pWs && pWs.currentFicha && hasMeaningfulFichaProgress(pWs.currentFicha.data)) {
          if (!carryOverWs || String(pWs.updatedAt || '') > String(carryOverWs.updatedAt || '')) {
            carryOverWs = pWs;
          }
        }
      }
    });

    const closeTs = new Date(Date.now() - 5).toISOString();
    const activeTs = new Date().toISOString();

    Object.keys(crewsMap).forEach(cid => {
      if (cid === newCrewId) return;
      const c = crewsMap[cid];
      if (!c || c.active === false || !Array.isArray(c.members)) return;
      const overlaps = c.members.some(m => cleanNames.includes(String(m).toLowerCase()));
      if (overlaps) {
        crewsMap[cid] = Object.assign({}, c, {
          active: false,
          endedBy: initiatorUsername || '',
          updatedAt: closeTs
        });
      }
    });

    const prevEntry = crewsMap[newCrewId];
    crewsMap[newCrewId] = {
      crewId: newCrewId,
      members: cleanNames,
      active: true,
      createdBy: (prevEntry && prevEntry.createdBy) || initiatorUsername || cleanNames[0],
      updatedBy: initiatorUsername || cleanNames[0],
      updatedAt: activeTs
    };
    setCrewTeamsMap(crewsMap);

    const targetWs = ensureCrewWorkspaceShape(newCrewId, sharedMap[newCrewId]);
    if (carryOverWs && (!targetWs.currentFicha || !hasMeaningfulFichaProgress(targetWs.currentFicha.data))) {
      targetWs.currentFicha = JSON.parse(JSON.stringify(carryOverWs.currentFicha));
      targetWs.updatedAt = activeTs;
      sharedMap[newCrewId] = targetWs;
      setSharedFichasMap(sharedMap);
    }

    markGitHubDirty();
    return hydrateCrewRecord(crewsMap[newCrewId], initiatorUsername);
  }

  function clearActiveCrewForUser(username) {
    const uname = String(username || '').trim().toLowerCase();
    if (!uname) return false;
    const crewsMap = getCrewTeamsMap();
    const now = new Date().toISOString();
    let changed = false;

    Object.keys(crewsMap).forEach(cid => {
      const c = crewsMap[cid];
      if (!c || c.active === false || !Array.isArray(c.members)) return;
      if (c.members.map(x => String(x).toLowerCase()).includes(uname)) {
        crewsMap[cid] = Object.assign({}, c, {
          active: false,
          endedBy: uname,
          updatedAt: now
        });
        changed = true;
      }
    });

    if (changed) {
      setCrewTeamsMap(crewsMap);
      markGitHubDirty();
    }
    return changed;
  }

  function saveCrewCurrentFicha(crewId, doc, skipDirty) {
    if (!crewId || !doc || !doc.data || !doc.sessionId) return null;
    const map = getSharedFichasMap();
    const ws = ensureCrewWorkspaceShape(crewId, map[crewId]);
    const now = doc.updatedAt || new Date().toISOString();

    ws.currentFicha = mergeSharedFichaDocs(ws.currentFicha, doc, ws.closedSessions);
    ws.updatedAt = now;
    map[crewId] = ws;
    setSharedFichasMap(map);
    if (!skipDirty) markGitHubDirty();
    return ws.currentFicha;
  }

  function closeCrewCurrentSession(crewId, sessionId, reason, recordId, newKmFinal, skipDirty) {
    if (!crewId) return null;
    const map = getSharedFichasMap();
    const ws = ensureCrewWorkspaceShape(crewId, map[crewId]);
    const now = new Date().toISOString();
    const sid = sessionId || (ws.currentFicha && ws.currentFicha.sessionId) || '';
    if (sid) {
      ws.closedSessions[sid] = {
        closedAt: now,
        reason: reason || 'closed',
        recordId: recordId || ''
      };
    }
    if (ws.currentFicha && (!sid || ws.currentFicha.sessionId === sid)) {
      ws.currentFicha = null;
    }
    if (newKmFinal !== undefined && String(newKmFinal || '').trim() !== '') {
      ws.lastKmFinal = String(newKmFinal).trim();
      ws.lastKmUpdatedAt = now;
    }
    ws.closedSessions = pruneMapByTimestamp(ws.closedSessions, 40, v => v && v.closedAt);
    ws.updatedAt = now;
    map[crewId] = ws;
    setSharedFichasMap(map);
    if (!skipDirty) markGitHubDirty();
    return ws;
  }

  async function syncAllCrewDraftsToLocalRecords() {
    const sess = getSession();
    if (!sess || !sess.username) return false;
    const activeCrew = getActiveCrewForUser(sess.username);
    if (!activeCrew) return false;
    const ws = getCrewWorkspace(activeCrew.crewId);
    if (!ws) return false;

    let changed = false;
    const draftEntries = Object.values(ws.draftRecords || {});
    for (const remoteDraft of draftEntries) {
      if (!remoteDraft || !remoteDraft.id) continue;
      const existing = await getRecordById(remoteDraft.id);
      if (!existing) {
        await saveRecordLocal(remoteDraft, { fromRemoteMerge: true });
        changed = true;
      } else if (existing.syncStatus === 'draft') {
        const remTs = String(remoteDraft.updatedAt || remoteDraft.createdAt || '');
        const locTs = String(existing.updatedAt || existing.createdAt || '');
        if (remTs > locTs) {
          await saveRecordLocal(remoteDraft, { fromRemoteMerge: true });
          changed = true;
        }
      }
    }

    const closedIds = Object.keys(ws.closedDraftIds || {});
    for (const cid of closedIds) {
      const closedTs = String(ws.closedDraftIds[cid] || '');
      const existing = await getRecordById(cid);
      if (existing && existing.syncStatus === 'draft') {
        const locTs = String(existing.updatedAt || existing.createdAt || '');
        if (!locTs || closedTs >= locTs) {
          await deleteRecordLocal(cid, { fromRemoteMerge: true });
          changed = true;
        }
      }
    }
    return changed;
  }

  function buildInternalDbExportObject() {
    const delMap = getDeletedUsersMap();
    const cutoff14d = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const cutoff7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const rawCrews = getCrewTeamsMap();
    const exportCrews = {};
    Object.keys(rawCrews).forEach(cid => {
      const c = rawCrews[cid];
      if (!c) return;
      if (c.active !== false || String(c.updatedAt || '') >= cutoff14d) {
        exportCrews[cid] = c;
      }
    });

    const rawShared = getSharedFichasMap();
    const exportShared = {};
    Object.keys(rawShared).forEach(cid => {
      const ws = ensureCrewWorkspaceShape(cid, rawShared[cid]);
      const isCrewActive = Boolean(exportCrews[cid] && exportCrews[cid].active !== false);
      if (isCrewActive || String(ws.updatedAt || '') >= cutoff7d) {
        exportShared[cid] = {
          crewId: cid,
          updatedAt: ws.updatedAt,
          lastKmFinal: ws.lastKmFinal,
          lastKmUpdatedAt: ws.lastKmUpdatedAt,
          currentFicha: ws.currentFicha,
          closedSessions: pruneMapByTimestamp(ws.closedSessions, 40, v => v && v.closedAt),
          draftRecords: pruneMapByTimestamp(ws.draftRecords, 25, v => v && (v.updatedAt || v.createdAt)),
          closedDraftIds: pruneMapByTimestamp(ws.closedDraftIds, 50, v => v)
        };
      }
    });

    const curSet = getSettings();
    return {
      schemaVersion: 3,
      system: 'SAMU 192 - Orlandia-SP',
      defaultHospital: curSet.defaultHospital || 'HBSA',
      driveConfig: {
        scriptUrl: curSet.scriptUrl || '',
        rootFolderUrl: curSet.rootFolderUrl || '',
        spreadsheetUrl: curSet.spreadsheetUrl || '',
        updatedAt: curSet.driveUpdatedAt || ''
      },
      updatedAt: new Date().toISOString(),
      deletedUsersMap: delMap,
      deletedUsernames: Object.keys(delMap),
      users: getLocalUsers(),
      hospitalReceivers: getHospitalReceivers(),
      medicosReguladores: getMedicosReguladores(),
      patients: getInternalPatientsMap(),
      viaturaAvarias: getViaturaAvariasMap(),
      activeCrews: exportCrews,
      sharedFichas: exportShared
    };
  }

  function mergeRemoteDatabaseIntoInternal(remote) {
    if (!remote || typeof remote !== 'object') return false;
    let changedLocal = false;

    // 1. Mescla tombstones de usuários excluídos/recusados
    const localDel = getDeletedUsersMap();
    const remoteDel = Object.assign({}, remote.deletedUsersMap || {});
    if (Array.isArray(remote.deletedUsernames)) {
      remote.deletedUsernames.forEach(u => {
        const k = String(u || '').toLowerCase();
        if (k && !remoteDel[k]) remoteDel[k] = remote.updatedAt || '2026-01-02T00:00:00.000Z';
      });
    }
    const mergedDel = Object.assign({}, localDel);
    Object.keys(remoteDel).forEach(u => {
      if (!mergedDel[u] || String(remoteDel[u]) > String(mergedDel[u])) {
        mergedDel[u] = remoteDel[u];
      }
    });
    setDeletedUsersMap(mergedDel);

    // 2. Mescla usuários (aprovados + pendentes + assinatura pessoal sincronizada)
    if (Array.isArray(remote.users)) {
      const byUname = new Map();
      getLocalUsers().forEach(u => byUname.set(u.username.toLowerCase(), normalizeUserObj(u)));

      let sigMap = {};
      try { sigMap = JSON.parse(safeLS.getItem(LS_USER_SIGS) || '{}') || {}; } catch (e) { sigMap = {}; }
      let sigMapChanged = false;

      remote.users.forEach(ruRaw => {
        const ru = normalizeUserObj(ruRaw);
        if (!ru.username) return;
        const cur = byUname.get(ru.username);
        if (!cur) {
          const delTs = mergedDel[ru.username];
          if (!delTs || String(ru.updatedAt) > String(delTs)) {
            byUname.set(ru.username, ru);
            if (ru.savedSignature && !sigMap[ru.username]) {
              sigMap[ru.username] = ru.savedSignature;
              sigMapChanged = true;
            }
            changedLocal = true;
          }
        } else {
          // Mantém o registro mais recente (ex: quando Adm aprovou no GitHub ou colega salvou assinatura)
          if (String(ru.updatedAt || '') >= String(cur.updatedAt || '')) {
            if (!ru.savedSignature && cur.savedSignature) {
              ru.savedSignature = cur.savedSignature;
            }
            byUname.set(ru.username, ru);
            if (ru.savedSignature && sigMap[ru.username] !== ru.savedSignature) {
              sigMap[ru.username] = ru.savedSignature;
              sigMapChanged = true;
            }
            changedLocal = true;
          } else if (!cur.savedSignature && ru.savedSignature) {
            cur.savedSignature = ru.savedSignature;
            byUname.set(ru.username, cur);
            if (!sigMap[ru.username]) {
              sigMap[ru.username] = ru.savedSignature;
              sigMapChanged = true;
            }
            changedLocal = true;
          }
        }
      });

      if (sigMapChanged) {
        try { safeLS.setItem(LS_USER_SIGS, JSON.stringify(sigMap)); } catch (e) {}
      }

      // Remove quem foi excluído mais recentemente (garantindo sempre pelo menos 1 ADM ativo no sistema)
      Array.from(byUname.keys()).forEach(uname => {
        const u = byUname.get(uname);
        const delTs = mergedDel[uname];
        if (delTs && String(delTs) > String(u.updatedAt || '')) {
          if (isUserAdmin(u)) {
            const otherActiveAdmins = Array.from(byUname.values()).filter(x => x.username !== uname && x.active !== false && isUserAdmin(x));
            if (!otherActiveAdmins.length) return;
          }
          byUname.delete(uname);
          changedLocal = true;
        }
      });

      setLocalUsers(Array.from(byUname.values()));
    }

    // 3. Mescla recebedores do hospital (Nome + COREN/CRM)
    if (Array.isArray(remote.hospitalReceivers)) {
      const recMap = new Map();
      getHospitalReceivers().forEach(r => recMap.set(r.id || normKey(r.nome), r));
      remote.hospitalReceivers.forEach(rr => {
        if (!rr || !rr.nome) return;
        const id = rr.id || normKey(rr.nome);
        const cur = recMap.get(id);
        if (!cur || String(rr.updatedAt || '') >= String(cur.updatedAt || '')) {
          recMap.set(id, {
            id,
            nome: String(rr.nome).trim(),
            corenCrm: String(rr.corenCrm || (cur && cur.corenCrm) || '').trim(),
            hospital: String(rr.hospital || (cur && cur.hospital) || 'HBSA').trim(),
            useCount: Math.max(Number(rr.useCount) || 1, Number(cur && cur.useCount) || 1),
            updatedAt: rr.updatedAt || (cur && cur.updatedAt) || new Date().toISOString()
          });
          changedLocal = true;
        }
      });
      setHospitalReceivers(Array.from(recMap.values()));
    }

    // 3b. Mescla médicos reguladores salvos nas fichas
    if (Array.isArray(remote.medicosReguladores)) {
      const medMap = new Map();
      getMedicosReguladores().forEach(m => medMap.set(m.id || normKey(m.nome), m));
      remote.medicosReguladores.forEach(rm => {
        if (!rm || !rm.nome) return;
        const cleanNome = extractCleanMedicoName(rm.nome);
        if (!cleanNome) return;
        const id = rm.id || normKey(cleanNome);
        const cur = medMap.get(id);
        if (!cur || String(rm.updatedAt || '') >= String(cur.updatedAt || '')) {
          medMap.set(id, {
            id,
            nome: cleanNome,
            useCount: Math.max(Number(rm.useCount) || 1, Number(cur && cur.useCount) || 1),
            updatedAt: rm.updatedAt || (cur && cur.updatedAt) || new Date().toISOString()
          });
          changedLocal = true;
        }
      });
      setMedicosReguladores(Array.from(medMap.values()));
    }

    // 4. Mescla base interna de pacientes por CPF
    if (remote.patients && typeof remote.patients === 'object') {
      const patMap = getInternalPatientsMap();
      Object.keys(remote.patients).forEach(cpfKey => {
        const cleanKey = String(cpfKey).replace(/\D+/g, '');
        if (cleanKey.length !== 11) return;
        const rp = remote.patients[cpfKey];
        const lp = patMap[cleanKey];
        if (!lp || String((rp && rp.updatedAt) || '') >= String((lp && lp.updatedAt) || '')) {
          patMap[cleanKey] = rp;
          changedLocal = true;
        }
      });
      setInternalPatientsMap(patMap);
    }

    // 5. Mescla equipes ativas do plantão (activeCrews)
    if (remote.activeCrews && typeof remote.activeCrews === 'object') {
      const crewsMap = getCrewTeamsMap();
      let crewsChanged = false;
      Object.keys(remote.activeCrews).forEach(cid => {
        const rc = remote.activeCrews[cid];
        if (!rc || !Array.isArray(rc.members)) return;
        const lc = crewsMap[cid];
        if (!lc || String(rc.updatedAt || '') > String(lc.updatedAt || '')) {
          crewsMap[cid] = rc;
          crewsChanged = true;
        }
      });

      // Se um integrante entrou em uma equipe mais recente, desativa vínculos antigos conflitantes
      const activeEntries = Object.values(crewsMap)
        .filter(c => c && c.active !== false && Array.isArray(c.members))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      const claimedMembers = new Set();
      activeEntries.forEach(c => {
        const hasClaimed = c.members.some(m => claimedMembers.has(String(m).toLowerCase()));
        if (hasClaimed) {
          crewsMap[c.crewId] = Object.assign({}, c, { active: false });
          crewsChanged = true;
        } else {
          c.members.forEach(m => claimedMembers.add(String(m).toLowerCase()));
        }
      });

      if (crewsChanged) {
        setCrewTeamsMap(crewsMap);
        changedLocal = true;
      }
    }

    // 6. Mescla fichas compartilhadas da equipe (campo a campo via fieldTs)
    if (remote.sharedFichas && typeof remote.sharedFichas === 'object') {
      const sharedMap = getSharedFichasMap();
      let sharedChanged = false;
      Object.keys(remote.sharedFichas).forEach(cid => {
        const rWs = remote.sharedFichas[cid];
        if (!rWs || typeof rWs !== 'object') return;
        const mergedWs = mergeCrewWorkspaces(sharedMap[cid], rWs);
        sharedMap[cid] = mergedWs;
        sharedChanged = true;
      });
      if (sharedChanged) {
        setSharedFichasMap(sharedMap);
        changedLocal = true;
      }
    }

    // 7. Mescla avarias salvas de cada viatura (amassados, riscados, danificados)
    if (remote.viaturaAvarias && typeof remote.viaturaAvarias === 'object') {
      const localAv = getViaturaAvariasMap();
      let avChanged = false;
      Object.keys(remote.viaturaAvarias).forEach(vKey => {
        const rEntry = remote.viaturaAvarias[vKey];
        if (!rEntry || typeof rEntry !== 'object') return;
        const lEntry = localAv[vKey];
        if (!lEntry || String(rEntry.updatedAt || '') > String(lEntry.updatedAt || '')) {
          localAv[vKey] = {
            key: vKey,
            viaturaId: String(rEntry.viaturaId || vKey),
            outraPlaca: String(rEntry.outraPlaca || ''),
            marks: sanitizeAvariasList(rEntry.marks),
            updatedAt: rEntry.updatedAt || new Date().toISOString(),
            updatedBy: String(rEntry.updatedBy || '')
          };
          avChanged = true;
        }
      });
      if (avChanged) {
        setViaturaAvariasMap(localAv);
        changedLocal = true;
      }
    }

    // 7b. Sincroniza automaticamente a URL do Google Drive configurada pelo ADM para todos os celulares
    if (remote.driveConfig && typeof remote.driveConfig === 'object') {
      const rDrive = remote.driveConfig;
      const curSet = getSettings();
      const rTs = String(rDrive.updatedAt || '');
      const lTs = String(curSet.driveUpdatedAt || '');
      const shouldApplyDrive = (!curSet.scriptUrl && rDrive.scriptUrl) || (rTs && rTs > lTs);
      if (shouldApplyDrive) {
        saveSettings({
          scriptUrl: String(rDrive.scriptUrl || '').trim(),
          rootFolderUrl: String(rDrive.rootFolderUrl || '').trim(),
          spreadsheetUrl: String(rDrive.spreadsheetUrl || '').trim(),
          driveUpdatedAt: rTs || remote.updatedAt || new Date().toISOString(),
          _fromRemoteMerge: true
        });
        changedLocal = true;
      }
    }

    // Se o usuário logado atualmente teve seu COREN, perfil ou KM da equipe atualizado, atualiza a sessão ativa
    const sess = getSession();
    if (sess && sess.username) {
      const freshMe = getLocalUsers().find(u => u.username.toLowerCase() === sess.username.toLowerCase());
      if (freshMe && freshMe.active) {
        setSession(Object.assign({}, sess, {
          name: freshMe.name,
          role: freshMe.role,
          subRole: getUserSubRole(freshMe),
          isAdmin: isUserAdmin(freshMe),
          coren: freshMe.coren || freshMe.councilId || '',
          councilId: freshMe.coren || freshMe.councilId || '',
          cpf: freshMe.cpf || ''
        }));
      }
      const myCrew = getActiveCrewForUser(sess.username);
      if (myCrew) {
        const myWs = getCrewWorkspace(myCrew.crewId);
        if (myWs && myWs.lastKmFinal) {
          const curKmNum = Number(getLastKmFinal() || 0);
          const wsKmNum = Number(myWs.lastKmFinal || 0);
          if (!curKmNum || wsKmNum >= curKmNum) {
            setLastKmFinal(myWs.lastKmFinal);
          }
        }
      }
      syncAllCrewDraftsToLocalRecords().catch(() => {});
    }

    return changedLocal;
  }

  let ongoingGitHubSync = null;

  async function syncInternalDbWithGitHub(options) {
    const opts = options || {};
    const cfg = parseGitHubConfig(opts.customSettings);
    if (!cfg) return { ok: false, skipped: true, reason: 'not_configured' };
    if (!navigator.onLine) return { ok: false, skipped: true, reason: 'offline' };

    if (ongoingGitHubSync) {
      try { await ongoingGitHubSync; } catch (e) {}
    }

    const runSync = async () => {
      const apiHeaders = {
        'Accept': 'application/vnd.github+json'
      };
      if (cfg.token) {
        apiHeaders['Authorization'] = `Bearer ${cfg.token}`;
      }

      let remoteJson = null;
      let fileSha = '';
      let fileMissingOnRepo = false;
      let pushed = false;
      const maxAttempts = 3;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        remoteJson = null;
        fileSha = '';
        fileMissingOnRepo = false;

        // 1. Consulta (PULL) no GitHub
        if (cfg.owner && cfg.repo && cfg.token) {
          const apiUrl = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(cfg.branch)}&_=${Date.now()}_${attempt}`;
          try {
            const meta = await genericHttpJson('GET', apiUrl, apiHeaders);
            if (meta && meta.content) {
              fileSha = meta.sha || '';
              remoteJson = JSON.parse(b64ToUtf8(meta.content));
            }
          } catch (err) {
            if (String(err.message || '').includes('404')) {
              fileMissingOnRepo = true;
            } else {
              throw err;
            }
          }
        } else if (cfg.rawUrl) {
          const sep = cfg.rawUrl.includes('?') ? '&' : '?';
          try {
            remoteJson = await genericHttpJson('GET', `${cfg.rawUrl}${sep}_=${Date.now()}_${attempt}`, {});
          } catch (errRaw) {
            if (String(errRaw.message || '').includes('404')) {
              fileMissingOnRepo = true;
            } else {
              throw errRaw;
            }
          }
        }

        if (remoteJson) {
          mergeRemoteDatabaseIntoInternal(remoteJson);
          await syncAllCrewDraftsToLocalRecords();
        }

        // 2. Gravação (PUSH) no GitHub se tiver Token e mudanças locais pendentes (ou arquivo novo)
        const shouldPush = Boolean(cfg.owner && cfg.repo && cfg.token && (opts.pushChanges || getGitHubMeta().dirty || fileMissingOnRepo));
        if (!shouldPush) {
          break;
        }

        const putUrl = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}`;
        const exportPayload = buildInternalDbExportObject();
        const bodyObj = {
          message: 'Atualizacao Base Interna SAMU 192 Orlandia',
          content: utf8ToB64(JSON.stringify(exportPayload, null, 2)),
          branch: cfg.branch
        };
        if (fileSha) bodyObj.sha = fileSha;

        try {
          await genericHttpJson(
            'PUT',
            putUrl,
            Object.assign({}, apiHeaders, { 'Content-Type': 'application/json; charset=utf-8' }),
            JSON.stringify(bodyObj)
          );
          pushed = true;
          break;
        } catch (putErr) {
          const msg = String((putErr && putErr.message) || '');
          const isShaConflict = msg.includes('409') || (fileSha && msg.includes('422'));
          if (isShaConflict && attempt < maxAttempts - 1) {
            await new Promise(res => setTimeout(res, 250 * (attempt + 1)));
            continue;
          }
          throw putErr;
        }
      }

      const now = new Date().toISOString();
      setGitHubMeta({ dirty: pushed ? false : (opts.pushChanges ? false : getGitHubMeta().dirty), lastSyncAt: now, lastError: '' });
      return {
        ok: true,
        pulled: Boolean(remoteJson),
        pushed,
        fileCreated: Boolean(fileMissingOnRepo && pushed),
        usersCount: getLocalUsers().length,
        pendingUsersCount: getPendingUsers().length,
        receiversCount: getHospitalReceivers().length,
        patientsCount: Object.keys(getInternalPatientsMap()).length,
        syncedAt: now
      };
    };

    ongoingGitHubSync = runSync();
    try {
      return await ongoingGitHubSync;
    } catch (err) {
      setGitHubMeta({ lastError: err.message || String(err) });
      throw err;
    } finally {
      ongoingGitHubSync = null;
    }
  }

  function importInternalDbJson(jsonTextOrObj) {
    const parsed = typeof jsonTextOrObj === 'string' ? JSON.parse(jsonTextOrObj) : jsonTextOrObj;
    if (!parsed || typeof parsed !== 'object') throw new Error('Arquivo JSON inválido.');
    mergeRemoteDatabaseIntoInternal(parsed);
    markGitHubDirty();
    return {
      usersCount: getLocalUsers().length,
      pendingCount: getPendingUsers().length,
      receiversCount: getHospitalReceivers().length,
      patientsCount: Object.keys(getInternalPatientsMap()).length
    };
  }

  /* ===================== AUTO-UPDATE DO APLICATIVO VIA GITHUB (LIVE OTA + APK) ===================== */
  function getInstalledAppVersion() {
    if (window.AndroidBridge && typeof window.AndroidBridge.getInstalledVersionJson === 'function') {
      try {
        const parsed = JSON.parse(window.AndroidBridge.getInstalledVersionJson());
        return {
          apkVersionCode: Number(parsed.apkVersionCode) || 1,
          apkVersionName: String(parsed.apkVersionName || '1.0.0'),
          otaRevision: Number(parsed.otaRevision) || 1,
          otaActive: Boolean(parsed.otaActive),
          isNativeApk: true
        };
      } catch (e) {}
    }
    return {
      apkVersionCode: 1,
      apkVersionName: '1.0.0',
      otaRevision: 1,
      otaActive: false,
      isNativeApk: false
    };
  }

  async function fetchGitHubRepoFileText(cfg, relFilePath) {
    const cleanRel = String(relFilePath || '').replace(/^\/+/, '');
    if (cfg.owner && cfg.repo && cfg.token) {
      const apiUrl = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cleanRel.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(cfg.branch)}&_=${Date.now()}`;
      const meta = await genericHttpJson('GET', apiUrl, {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${cfg.token}`
      });
      if (meta && meta.content) {
        return b64ToUtf8(meta.content);
      }
    }
    if (cfg.owner && cfg.repo) {
      const rawFileUrl = `https://raw.githubusercontent.com/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/${encodeURIComponent(cfg.branch)}/${cleanRel}?_=${Date.now()}`;
      return await genericHttpText('GET', rawFileUrl, {});
    }
    throw new Error('Repositório GitHub inválido para buscar arquivo de atualização.');
  }

  let ongoingUpdateCheck = null;

  async function checkAndApplyAppUpdate() {
    if (!navigator.onLine) return { status: 'offline', local: getInstalledAppVersion() };
    const cfg = parseGitHubConfig();
    if (!cfg || !cfg.owner || !cfg.repo) return { status: 'not_configured', local: getInstalledAppVersion() };

    if (ongoingUpdateCheck) {
      try { return await ongoingUpdateCheck; } catch (e) {}
    }

    const runCheck = async () => {
      const local = getInstalledAppVersion();
      let remote = null;
      try {
        const verTxt = await fetchGitHubRepoFileText(cfg, 'version.json');
        remote = JSON.parse(verTxt);
      } catch (err) {
        if (String(err.message || '').includes('404')) {
          return { status: 'repo_empty_yet', local };
        }
        throw err;
      }

      const remoteApkCode = Number(remote.apkVersionCode) || 1;
      const remoteOtaRev = Number(remote.otaRevision) || 1;

      // 1. Verifica se saiu um novo instalador .APK compilado no GitHub Actions
      if (remoteApkCode > local.apkVersionCode) {
        let downloadUrl = remote.apkDownloadUrl || `https://github.com/${cfg.owner}/${cfg.repo}/releases/latest/download/SAMU_192_Orlandia.apk`;
        if (cfg.token) {
          try {
            const relUrl = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/releases/latest?_=${Date.now()}`;
            const relMeta = await genericHttpJson('GET', relUrl, {
              'Accept': 'application/vnd.github+json',
              'Authorization': `Bearer ${cfg.token}`
            });
            if (relMeta && Array.isArray(relMeta.assets)) {
              const apkAsset = relMeta.assets.find(a => a && String(a.name || '').toLowerCase().endsWith('.apk'));
              if (apkAsset && apkAsset.url) {
                downloadUrl = apkAsset.url;
              }
            }
          } catch (eRel) {}
        }
        return {
          status: 'apk_update_available',
          local,
          remote,
          downloadUrl
        };
      }

      // 2. Atualização silenciosa automática (Live OTA) de telas/regras/PDF sem precisar reinstalar o .APK!
      if (remoteOtaRev > local.otaRevision && local.isNativeApk && window.AndroidBridge && typeof window.AndroidBridge.applyOtaBundleJson === 'function') {
        const otaFiles = Array.isArray(remote.otaFiles) && remote.otaFiles.length
          ? remote.otaFiles
          : ['index.html', 'css/styles.css', 'js/schema.js', 'js/storage.js', 'js/signature.js', 'js/pdf-engine.js', 'js/app.js'];

        const otaPrefix = (remote.otaRepoPrefix !== undefined) ? String(remote.otaRepoPrefix) : 'web-app/';
        const filesMap = {};
        for (const relPath of otaFiles) {
          const cleanLocalPath = String(relPath || '').replace(/^\/+/, '');
          const repoPath = (otaPrefix && !cleanLocalPath.startsWith(otaPrefix))
            ? (otaPrefix.replace(/\/+$/, '') + '/' + cleanLocalPath)
            : cleanLocalPath;
          filesMap[cleanLocalPath] = await fetchGitHubRepoFileText(cfg, repoPath);
        }

        const ok = window.AndroidBridge.applyOtaBundleJson(JSON.stringify(remote), JSON.stringify(filesMap));
        if (ok) {
          return {
            status: 'ota_applied',
            local,
            remote
          };
        }
      }

      return {
        status: 'up_to_date',
        local,
        remote
      };
    };

    ongoingUpdateCheck = runCheck();
    try {
      return await ongoingUpdateCheck;
    } finally {
      ongoingUpdateCheck = null;
    }
  }

  function startNativeApkDownload(downloadUrl) {
    const s = getSettings();
    if (window.AndroidBridge && typeof window.AndroidBridge.downloadAndInstallApk === 'function') {
      window.AndroidBridge.downloadAndInstallApk(downloadUrl, s.githubToken || '');
      return true;
    }
    window.open(downloadUrl, '_blank', 'noopener');
    return false;
  }

  function reloadForOtaUpdate() {
    if (window.AndroidBridge && typeof window.AndroidBridge.reloadOtaApp === 'function') {
      window.AndroidBridge.reloadOtaApp();
      return;
    }
    window.location.reload();
  }

  /* ===================== SESSÃO E ASSINATURAS SALVAS ===================== */
  function getSession() {
    try {
      const raw = safeLS.getItem(LS_SESSION);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setSession(sess) {
    if (!sess) safeLS.removeItem(LS_SESSION);
    else safeLS.setItem(LS_SESSION, JSON.stringify(sess));
  }

  function getSavedSignature(username) {
    const uname = String(username || '').trim().toLowerCase();
    if (!uname) return '';
    try {
      const map = JSON.parse(safeLS.getItem(LS_USER_SIGS) || '{}');
      if (map && map[uname]) return map[uname];
    } catch (e) {}
    try {
      const found = getLocalUsers().find(u => u.username.toLowerCase() === uname);
      if (found && found.savedSignature) return found.savedSignature;
    } catch (e2) {}
    return '';
  }

  function savePersonalSignature(username, dataUrl) {
    const uname = String(username || '').trim().toLowerCase();
    if (!uname) return;
    const cleanSig = dataUrl || '';
    try {
      const map = JSON.parse(safeLS.getItem(LS_USER_SIGS) || '{}');
      map[uname] = cleanSig;
      safeLS.setItem(LS_USER_SIGS, JSON.stringify(map));
    } catch (e) {}
    try {
      const found = getLocalUsers().find(u => u.username.toLowerCase() === uname);
      if (found && String(found.savedSignature || '') !== cleanSig) {
        upsertLocalUser(Object.assign({}, found, {
          savedSignature: cleanSig,
          updatedAt: new Date().toISOString()
        }), false);
      }
    } catch (e2) {}
  }

  /* ===================== API GOOGLE APPS SCRIPT (DRIVE PDFs) ===================== */
  async function apiPost(payload, customUrl) {
    const settings = getSettings();
    const url = (customUrl || settings.scriptUrl || '').trim();
    if (!url) throw new Error('URL do Google Drive não configurada.');

    if (window.AndroidBridge && typeof window.AndroidBridge.postJson === 'function') {
      return new Promise((resolve, reject) => {
        const reqId = 'req_' + (nativeReqCounter++) + '_' + Date.now();
        pendingNativeCalls[reqId] = { resolve, reject };
        try {
          window.AndroidBridge.postJson(reqId, url, JSON.stringify(payload));
        } catch (err) {
          delete pendingNativeCalls[reqId];
          reject(err);
        }
      });
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('A URL informada não retornou JSON válido. Verifique se publicou o Google Apps Script com acesso "Qualquer pessoa".');
    }
  }

  /* ===================== LOGIN (CONSULTA GITHUB ONLINE + BASE INTERNA OFFLINE) ===================== */
  async function login(username, password) {
    const u = String(username || '').trim().toLowerCase();
    const p = String(password || '');
    if (!u || !p) throw new Error('Preencha usuário e senha.');

    await initInternalDb();

    // 1. Sempre que tiver internet e GitHub configurado, puxa a base atualizada antes de autenticar
    if (navigator.onLine && hasGitHubConfigured()) {
      try {
        await syncInternalDbWithGitHub({ pushChanges: getGitHubMeta().dirty });
      } catch (eGh) {}
    }

    // 2. Verifica na Base Interna (que já contém dados locais + dados sincronizados do GitHub)
    const localUsers = getLocalUsers();
    const byUser = localUsers.find(item => item.username.toLowerCase() === u);

    if (byUser && byUser.password === p) {
      if (byUser.status === 'pending') {
        throw new Error('⏳ Seu cadastro já foi enviado e está aguardando aprovação do Administrador na aba "Aprovar".');
      }
      if (byUser.status === 'rejected' || byUser.active === false) {
        throw new Error('❌ Seu cadastro está aguardando liberação ou foi desativado pela Coordenação.');
      }
      const sess = {
        username: byUser.username,
        password: byUser.password,
        name: byUser.name,
        role: byUser.role,
        subRole: getUserSubRole(byUser),
        isAdmin: isUserAdmin(byUser),
        cpf: byUser.cpf || '',
        coren: byUser.coren || byUser.councilId || '',
        councilId: byUser.coren || byUser.councilId || '',
        status: 'approved',
        active: true
      };
      setSession(sess);
      return { user: sess, mode: navigator.onLine && hasGitHubConfigured() ? 'github' : 'internal_offline' };
    }

    // 3. Fallback adicional: se usar Google Apps Script para login
    const settings = getSettings();
    if (settings.scriptUrl && navigator.onLine) {
      try {
        const res = await apiPost({ action: 'login', username: u, password: p });
        if (res && res.ok && res.user) {
          const sess = normalizeUserObj(Object.assign({}, res.user, { password: p, status: 'approved', active: true }));
          upsertLocalUser(sess, true);
          setSession(sess);
          return { user: sess, mode: 'drive_online' };
        }
      } catch (err) {}
    }

    if (byUser && byUser.status === 'pending') {
      throw new Error('⏳ Seu cadastro ainda aguarda aprovação do Administrador.');
    }

    throw new Error('Usuário ou senha incorretos.');
  }

  /* ===================== REGISTROS DE FICHAS E CHECK LISTS (SQLite Nativo APK + IndexedDB) ===================== */
  async function saveRecordLocal(record, opts) {
    const isRemoteMerge = Boolean(opts && opts.fromRemoteMerge);
    // Alimenta automaticamente a Base Interna Offline com o Recebedor do Hospital, Médico Regulador e o Paciente (CPF)
    if (record && record.type === 'ficha' && record.data) {
      if (record.data.recebidoPorNome && String(record.data.recebidoPorNome).trim()) {
        upsertHospitalReceiver({
          nome: record.data.recebidoPorNome,
          corenCrm: record.data.recebidoCorenCrm || '',
          hospital: record.data.destino || 'HBSA'
        }, isRemoteMerge);
      }
      if (record.data.medicoRegulador && String(record.data.medicoRegulador).trim()) {
        upsertMedicoRegulador({
          nome: record.data.medicoRegulador
        }, isRemoteMerge);
      }
      if (record.data.vitimaCpf && record.data.vitimaNome) {
        upsertPatientInInternalDb(record.data, isRemoteMerge);
      }
    }

    // Sincroniza rascunhos de fichas compartilhadas da equipe (📂 Rascunhos) entre os integrantes do plantão
    if (!isRemoteMerge && record && record.type === 'ficha' && record.crewId && record.id) {
      const sharedMap = getSharedFichasMap();
      const ws = ensureCrewWorkspaceShape(record.crewId, sharedMap[record.crewId]);
      const nowIso = record.updatedAt || new Date().toISOString();
      if (record.syncStatus === 'draft') {
        const cleanDraft = JSON.parse(JSON.stringify(record));
        delete cleanDraft.pendingPdfBase64;
        ws.draftRecords[record.id] = cleanDraft;
        delete ws.closedDraftIds[record.id];
      } else {
        delete ws.draftRecords[record.id];
        ws.closedDraftIds[record.id] = nowIso;
      }
      ws.draftRecords = pruneMapByTimestamp(ws.draftRecords, 25, v => v && (v.updatedAt || v.createdAt));
      ws.closedDraftIds = pruneMapByTimestamp(ws.closedDraftIds, 50, v => v);
      ws.updatedAt = nowIso;
      sharedMap[record.crewId] = ws;
      setSharedFichasMap(sharedMap);
      markGitHubDirty();
    }

    if (isNativeSqliteActive()) {
      try {
        window.AndroidBridge.dbPutRecord(
          String(record.id || ''),
          String(record.type || ''),
          String(record.createdBy || ''),
          String(record.createdAt || new Date().toISOString()),
          String(record.syncStatus || 'pending'),
          String(record.patientName || ''),
          String(record.patientCpf || ''),
          JSON.stringify(record)
        );
        return record;
      } catch (eSql) {}
    }

    const db = await openDB();
    if (!db) {
      memRecords.set(record.id, JSON.parse(JSON.stringify(record)));
      return record;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      tx.objectStore('records').put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getRecordById(id) {
    if (isNativeSqliteActive()) {
      try {
        const raw = window.AndroidBridge.dbGetRecord(String(id || ''));
        if (raw) return JSON.parse(raw);
      } catch (eSql) {}
    }

    const db = await openDB();
    if (!db) {
      return memRecords.get(id) || null;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readonly');
      const req = tx.objectStore('records').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteRecordLocal(id, opts) {
    const isRemoteMerge = Boolean(opts && opts.fromRemoteMerge);
    if (!isRemoteMerge && id) {
      const sharedMap = getSharedFichasMap();
      let sharedTouched = false;
      const nowIso = new Date().toISOString();
      Object.keys(sharedMap).forEach(cid => {
        const ws = ensureCrewWorkspaceShape(cid, sharedMap[cid]);
        if (ws.draftRecords && ws.draftRecords[id]) {
          delete ws.draftRecords[id];
          ws.closedDraftIds[id] = nowIso;
          ws.updatedAt = nowIso;
          sharedMap[cid] = ws;
          sharedTouched = true;
        }
      });
      if (sharedTouched) {
        setSharedFichasMap(sharedMap);
        markGitHubDirty();
      }
    }

    if (isNativeSqliteActive()) {
      try {
        window.AndroidBridge.dbDeleteRecord(String(id || ''));
      } catch (eSql) {}
    }

    const db = await openDB();
    if (!db) {
      memRecords.delete(id);
      return true;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      tx.objectStore('records').delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAllRecordsLocal() {
    if (isNativeSqliteActive()) {
      try {
        const rawArr = window.AndroidBridge.dbGetAllRecordsJson();
        const list = rawArr ? JSON.parse(rawArr) : [];
        if (Array.isArray(list)) {
          list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
          return list;
        }
      } catch (eSql) {}
    }

    const db = await openDB();
    if (!db) {
      const list = Array.from(memRecords.values());
      list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      return list;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readonly');
      const req = tx.objectStore('records').getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getVisibleRecords(user) {
    if (!user) return [];
    const all = await getAllRecordsLocal();
    if (isUserAdmin(user)) {
      return all;
    }
    const uname = user.username.toLowerCase();
    return all.filter(rec => {
      const isCreator = String(rec.createdBy || '').toLowerCase() === uname;
      const isCrewMate = rec.type === 'ficha' && Array.isArray(rec.crewMembers) &&
        rec.crewMembers.some(m => String(m || '').toLowerCase() === uname);
      if (!isCreator && !isCrewMate) return false;
      if (user.role === 'condutor' && rec.type === 'checklist_enfermagem') return false;
      if (user.role === 'enfermagem' && rec.type === 'checklist_condutor') return false;
      return true;
    });
  }

  async function saveDraft(username, type, data) {
    const key = String(username || '').toLowerCase() + '__' + type;
    const updatedAt = new Date().toISOString();
    const payloadObj = { key, username, type, data, updatedAt };

    if (isNativeSqliteActive()) {
      try {
        window.AndroidBridge.dbPutDraft(
          key,
          String(username || ''),
          String(type || ''),
          updatedAt,
          JSON.stringify(payloadObj)
        );
        return true;
      } catch (eSql) {}
    }

    const db = await openDB();
    if (!db) {
      memDrafts.set(key, payloadObj);
      return true;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put(payloadObj);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getDraft(username, type) {
    const key = String(username || '').toLowerCase() + '__' + type;
    if (isNativeSqliteActive()) {
      try {
        const raw = window.AndroidBridge.dbGetDraft(key);
        if (raw) return JSON.parse(raw);
      } catch (eSql) {}
    }

    const db = await openDB();
    if (!db) {
      return memDrafts.get(key) || null;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readonly');
      const req = tx.objectStore('drafts').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearDraft(username, type) {
    const key = String(username || '').toLowerCase() + '__' + type;
    if (isNativeSqliteActive()) {
      try {
        window.AndroidBridge.dbDeleteDraft(key);
      } catch (eSql) {}
    }

    const db = await openDB();
    if (!db) {
      memDrafts.delete(key);
      return true;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function uploadRecordToDrive(record, pdfBase64) {
    // Se tiver alterações na base interna (novo recebedor do hospital ou paciente), sincroniza no GitHub em paralelo
    if (navigator.onLine && hasGitHubConfigured() && getSettings().githubToken && getGitHubMeta().dirty) {
      syncInternalDbWithGitHub({ pushChanges: true }).catch(() => {});
    }

    const settings = getSettings();
    const sess = getSession();
    if (!settings.scriptUrl || !sess || !navigator.onLine) {
      record.syncStatus = 'pending';
      record.pendingPdfBase64 = pdfBase64 || record.pendingPdfBase64 || '';
      await saveRecordLocal(record);
      return { synced: false, reason: !settings.scriptUrl ? 'no_url' : 'offline' };
    }

    try {
      const cleanRecordForCloud = Object.assign({}, record);
      delete cleanRecordForCloud.pendingPdfBase64;

      const res = await apiPost({
        action: 'uploadRecord',
        authUser: sess.username,
        authPass: sess.password,
        authName: sess.name || sess.username,
        authRole: getUserProfileChoice(sess),
        authCouncilId: sess.coren || sess.councilId || '',
        record: cleanRecordForCloud,
        pdfBase64: pdfBase64 || record.pendingPdfBase64 || ''
      });

      if (res && res.ok) {
        record.syncStatus = 'synced';
        record.driveFileId = res.driveFileId || record.driveFileId || '';
        record.driveUrl = res.driveUrl || record.driveUrl || '';
        record.syncedAt = res.syncedAt || new Date().toISOString();
        delete record.pendingPdfBase64;
        await saveRecordLocal(record);
        return { synced: true, driveUrl: record.driveUrl };
      } else {
        throw new Error((res && res.error) || 'Falha ao enviar ao Google Drive.');
      }
    } catch (err) {
      record.syncStatus = 'pending';
      record.lastSyncError = err.message;
      record.pendingPdfBase64 = pdfBase64 || record.pendingPdfBase64 || '';
      await saveRecordLocal(record);
      return { synced: false, reason: 'error', error: err.message };
    }
  }

  async function syncAllWithCloud() {
    let ghResult = null;
    if (navigator.onLine && hasGitHubConfigured()) {
      try {
        ghResult = await syncInternalDbWithGitHub({ pushChanges: getGitHubMeta().dirty });
      } catch (eGh) {}
    }

    const settings = getSettings();
    const sess = getSession();
    if (!settings.scriptUrl || !sess || !navigator.onLine) {
      return { ok: Boolean(ghResult && ghResult.ok), skippedDrive: true, github: ghResult, uploadedCount: 0 };
    }

    const allLocal = await getAllRecordsLocal();
    const pendingList = allLocal.filter(r => r.syncStatus === 'pending' && (isUserAdmin(sess) || String(r.createdBy || '').toLowerCase() === sess.username.toLowerCase()));
    let uploadedCount = 0;

    for (const item of pendingList) {
      let pdfB64 = item.pendingPdfBase64 || '';
      if (!pdfB64 && window.SamuPDF) {
        try {
          const generated = await window.SamuPDF.generatePdfForRecord(item);
          pdfB64 = generated.base64;
        } catch (eGen) {}
      }
      const up = await uploadRecordToDrive(item, pdfB64);
      if (up.synced) uploadedCount++;
    }

    const histRes = await apiPost({
      action: 'listHistory',
      authUser: sess.username,
      authPass: sess.password,
      authName: sess.name || sess.username,
      authRole: getUserProfileChoice(sess),
      authCouncilId: sess.coren || sess.councilId || ''
    });

    if (histRes && histRes.ok && Array.isArray(histRes.records)) {
      if (histRes.rootFolderUrl || histRes.spreadsheetUrl) {
        saveSettings({
          rootFolderUrl: histRes.rootFolderUrl || settings.rootFolderUrl,
          spreadsheetUrl: histRes.spreadsheetUrl || settings.spreadsheetUrl
        });
      }
      for (const remoteRec of histRes.records) {
        const existing = await getRecordById(remoteRec.id);
        if (!existing || (existing.syncStatus !== 'pending' && existing.syncStatus !== 'draft')) {
          await saveRecordLocal(remoteRec);
        }
      }
    }

    return { ok: true, uploadedCount, github: ghResult };
  }

  /* ===================== ÚLTIMO KM FINAL -> KM INICIAL ===================== */
  function getLastKmFinal() {
    return safeLS.getItem(LS_LAST_KM) || '';
  }

  function setLastKmFinal(kmValue) {
    const clean = String(kmValue == null ? '' : kmValue).trim();
    if (clean !== '') {
      safeLS.setItem(LS_LAST_KM, clean);
      mirrorKvToIndexedDB(LS_LAST_KM, clean);
    }
  }

  /* ===================== CONSULTA ONLINE DE CEP E CPF ===================== */
  async function httpGetJson(url) {
    if (window.AndroidBridge && typeof window.AndroidBridge.getJson === 'function') {
      return new Promise((resolve, reject) => {
        const reqId = 'get_' + (nativeReqCounter++) + '_' + Date.now();
        pendingNativeCalls[reqId] = { resolve, reject };
        try {
          window.AndroidBridge.getJson(reqId, url);
        } catch (err) {
          delete pendingNativeCalls[reqId];
          reject(err);
        }
      });
    }
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
  }

  async function lookupCepOnline(rawCep) {
    const cep = String(rawCep || '').replace(/\D+/g, '');
    if (cep.length !== 8) throw new Error('CEP deve ter 8 dígitos.');
    if (!navigator.onLine) throw new Error('Sem conexão Wi-Fi/4G para buscar o CEP.');

    try {
      const via = await httpGetJson(`https://viacep.com.br/ws/${cep}/json/`);
      if (via && !via.erro) {
        return {
          cep: via.cep || `${cep.slice(0, 5)}-${cep.slice(5)}`,
          endereco: via.logradouro || '',
          bairro: via.bairro || '',
          cidade: via.localidade || '',
          uf: via.uf || '',
          complemento: via.complemento || ''
        };
      }
    } catch (e1) {}

    const br = await httpGetJson(`https://brasilapi.com.br/api/cep/v1/${cep}`);
    if (br && (br.street || br.city)) {
      return {
        cep: `${cep.slice(0, 5)}-${cep.slice(5)}`,
        endereco: br.street || '',
        bairro: br.neighborhood || '',
        cidade: br.city || '',
        uf: br.state || '',
        complemento: ''
      };
    }
    throw new Error('CEP não encontrado.');
  }

  async function lookupPatientByCpf(rawCpf) {
    const cleanCpf = String(rawCpf || '').replace(/\D+/g, '');
    if (cleanCpf.length !== 11) throw new Error('Digite os 11 números do CPF.');

    // 1. Consulta instantânea na Base de Dados Interna Offline (tabela patients)
    const internalPatients = getInternalPatientsMap();
    if (internalPatients[cleanCpf] && internalPatients[cleanCpf].vitimaNome) {
      return { source: 'internal_db', patient: internalPatients[cleanCpf] };
    }

    // 2. Procura nas fichas salvas localmente no aparelho
    const allLocal = await getAllRecordsLocal();
    for (const rec of allLocal) {
      if (rec.type !== 'ficha') continue;
      const rCpf = String(rec.patientCpf || (rec.data && rec.data.vitimaCpf) || '').replace(/\D+/g, '');
      if (rCpf === cleanCpf && rec.data && rec.data.vitimaNome) {
        upsertPatientInInternalDb(rec.data, true);
        return { source: 'local', patient: rec.data };
      }
    }

    // 3. Se tiver internet e GitHub configurado, puxa atualização do GitHub e checa novamente
    if (navigator.onLine && hasGitHubConfigured()) {
      try {
        await syncInternalDbWithGitHub({ pushChanges: false });
        const afterGh = getInternalPatientsMap();
        if (afterGh[cleanCpf] && afterGh[cleanCpf].vitimaNome) {
          return { source: 'github_db', patient: afterGh[cleanCpf] };
        }
      } catch (eGh) {}
    }

    // 4. Se estiver em Wi-Fi/4G e conectado ao Google Drive da Central SAMU Orlândia
    const settings = getSettings();
    const sess = getSession();
    if (navigator.onLine && settings.scriptUrl && sess) {
      try {
        const res = await apiPost({
          action: 'lookupCpf',
          authUser: sess.username,
          authPass: sess.password,
          authName: sess.name || sess.username,
          authRole: getUserProfileChoice(sess),
          authCouncilId: sess.coren || sess.councilId || '',
          cpf: cleanCpf
        });
        if (res && res.ok && res.found && res.patient) {
          upsertPatientInInternalDb(res.patient, true);
          return { source: 'samu_cloud', patient: res.patient };
        }
      } catch (eCloud) {}
    }

    // 5. API Externa opcional de CPF (ex: CADSUS / Serpro / CPFHub)
    if (navigator.onLine && settings.cpfApiUrl) {
      try {
        const apiUrl = settings.cpfApiUrl.replace('{cpf}', cleanCpf);
        const ext = await httpGetJson(apiUrl);
        const p = (ext && (ext.data || ext.result || ext)) || null;
        if (p && (p.nome || p.name)) {
          const built = {
            vitimaNome: p.nome || p.name || '',
            vitimaDn: p.data_nascimento || p.nascimento || p.birthDate || '',
            vitimaMae: p.nome_mae || p.mae || p.motherName || '',
            vitimaCpf: formatCpf(cleanCpf)
          };
          upsertPatientInInternalDb(built, true);
          return { source: 'external_api', patient: built };
        }
      } catch (eExt) {}
    }

    return null;
  }

  // Inicializa espelhamento IndexedDB logo na partida
  initInternalDb();

  window.SamuStorage = {
    isNativeSqliteActive,
    initInternalDb,
    getSettings,
    saveSettings,
    getGitHubMeta,
    hasGitHubConfigured,
    syncInternalDbWithGitHub,
    getInstalledAppVersion,
    checkAndApplyAppUpdate,
    startNativeApkDownload,
    reloadForOtaUpdate,
    buildInternalDbExportObject,
    importInternalDbJson,
    isUserAdmin,
    hasOperationalRole,
    getUserSubRole,
    getUserProfileChoice,
    mapProfileChoiceToFields,
    getUserRoleLabel,
    getUserRoleIcon,
    getLocalUsers,
    setLocalUsers,
    upsertLocalUser,
    deleteLocalUser,
    getPendingUsers,
    registerUserRequest,
    approveUser,
    rejectUser,
    validateCrewSelection,
    getActiveCrewForUser,
    setActiveCrewForUsers,
    clearActiveCrewForUser,
    getCrewWorkspace,
    hasMeaningfulFichaProgress,
    mergeSharedFichaDocs,
    saveCrewCurrentFicha,
    closeCrewCurrentSession,
    syncAllCrewDraftsToLocalRecords,
    getHospitalReceivers,
    upsertHospitalReceiver,
    deleteHospitalReceiver,
    getMedicosReguladores,
    upsertMedicoRegulador,
    deleteMedicoRegulador,
    getViaturaStorageKey,
    getViaturaAvariasMap,
    getViaturaAvarias,
    saveViaturaAvarias,
    getInternalPatientsMap,
    upsertPatientInInternalDb,
    getSession,
    setSession,
    getSavedSignature,
    savePersonalSignature,
    apiPost,
    login,
    saveRecordLocal,
    getRecordById,
    deleteRecordLocal,
    getAllRecordsLocal,
    getVisibleRecords,
    saveDraft,
    getDraft,
    clearDraft,
    uploadRecordToDrive,
    syncAllWithCloud,
    getLastKmFinal,
    setLastKmFinal,
    lookupCepOnline,
    formatCpf,
    isValidCpf,
    lookupPatientByCpf
  };
})();
