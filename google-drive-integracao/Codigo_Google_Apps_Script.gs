/**
 * ============================================================================
 * SAMU 192 – ORLÂNDIA-SP | BACKEND GRATUITO GOOGLE DRIVE + GOOGLE PLANILHAS
 * ============================================================================
 * Este script recebe os PDFs gerados pelo APK nos celulares da equipe,
 * organiza automaticamente em pastas no Google Drive por Tipo e Mês (AAAA-MM),
 * gerencia os Logins/Senhas por perfil (Adm, Condutor, Enfermagem) e sincroniza
 * o Histórico respeitando as permissões de acesso:
 *   - ADM: vê todas as Fichas e todos os Check Lists (Condutores e Enfermagem)
 *   - CONDUTOR / ENFERMAGEM: vê apenas o histórico das próprias Fichas e Check Lists
 */

var ROOT_FOLDER_NAME = 'SAMU 192 Orlândia - Sistema Digital';
var DB_SHEET_NAME = 'SAMU 192 Orlândia - Controle e Histórico';
// Opcional: deixe em branco ('') para o sistema criar a pasta raiz e as 3 subpastas sozinho automaticamente!
var OPTIONAL_ROOT_FOLDER_ID = '';

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'ping';
  if (action === 'ping') {
    var env = ensureEnvironment_();
    migrateExistingPdfsToLinkView_(env);
    return jsonResponse_({
      ok: true,
      service: 'SAMU 192 Orlândia - Google Drive Sync',
      version: 3,
      syncDatabaseReady: true,
      deleteRecordReady: true,
      rootFolderUrl: env.rootFolder.getUrl(),
      spreadsheetUrl: env.ss.getUrl(),
      timestamp: new Date().toISOString()
    });
  }
  return jsonResponse_({ ok: false, error: 'Use POST para operações de dados.' });
}

function filterDbForPrintQueueOnly_(dbObj) {
  var srcAv = (dbObj && dbObj.viaturaAvarias) || {};
  var outAv = {};
  var keys = Object.keys(srcAv);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.indexOf('__pjob_') === 0 || k.indexOf('__print_') === 0) {
      outAv[k] = srcAv[k];
    }
  }
  return {
    schemaVersion: (dbObj && dbObj.schemaVersion) || 3,
    updatedAt: (dbObj && dbObj.updatedAt) || new Date().toISOString(),
    viaturaAvarias: outAv
  };
}

function enqueuePrintJobOnServerDb_(serverDb, rec, driveFileId, driveFileUrl, opts, caller) {
  var avMap = Object.assign({}, serverDb.viaturaAvarias || {});
  var nowIso = new Date().toISOString();
  var recId = String((rec && rec.id) || '');

  // Evita duplicidade caso o mesmo registro já esteja pendente
  for (var s = 0; s < 80; s++) {
    var skCheck = '__pjob_' + (s < 10 ? '0' + s : String(s));
    var ex = avMap[skCheck];
    if (ex && ex.jobId && ex.recordId === recId && ex.status === 'pending' && (!driveFileId || ex.driveFileId === driveFileId)) {
      return ex;
    }
  }

  var jobId = 'pj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  var seed = jobId + '_' + recId;
  var h = 0;
  for (var c = 0; c < seed.length; c++) {
    h = ((h << 5) - h + seed.charCodeAt(c)) | 0;
  }
  var startIdx = Math.abs(h) % 80;
  var chosenSlot = '';
  for (var step = 0; step < 80; step++) {
    var sk = '__pjob_' + (((startIdx + step) % 80) < 10 ? '0' + ((startIdx + step) % 80) : String((startIdx + step) % 80));
    if (!avMap[sk] || !avMap[sk].jobId) {
      chosenSlot = sk;
      break;
    }
  }
  if (!chosenSlot) {
    var oldestFinishedTs = '\uffff';
    for (var step2 = 0; step2 < 80; step2++) {
      var sk2 = '__pjob_' + (((startIdx + step2) % 80) < 10 ? '0' + ((startIdx + step2) % 80) : String((startIdx + step2) % 80));
      var cur2 = avMap[sk2];
      if (cur2 && cur2.status !== 'pending') {
        var ts2 = String(cur2.updatedAt || cur2.createdAt || '');
        if (ts2 < oldestFinishedTs) {
          oldestFinishedTs = ts2;
          chosenSlot = sk2;
        }
      }
    }
  }
  if (!chosenSlot) {
    chosenSlot = '__pjob_' + (startIdx < 10 ? '0' + startIdx : String(startIdx));
  }

  var job = {
    key: chosenSlot,
    slotKey: chosenSlot,
    jobId: jobId,
    recordId: recId,
    recordType: String((rec && rec.type) || 'ficha'),
    title: String((opts && opts.title) || recId),
    date: String((rec && rec.date) || nowIso.slice(0, 10)),
    driveFileId: String(driveFileId || ''),
    driveUrl: String(driveFileUrl || ''),
    isTestPage: false,
    duplexMode: (opts && opts.duplexMode === 'simplex') ? 'simplex' : 'duplex',
    copies: Math.max(1, Math.min(5, Number(opts && opts.copies) || 1)),
    trigger: String((opts && opts.trigger) || 'auto'),
    requestedBy: String((opts && opts.requestedBy) || (caller && caller.username) || ''),
    requestedByName: String((opts && opts.requestedByName) || (caller && caller.name) || ''),
    createdAt: nowIso,
    status: 'pending',
    printedAt: '',
    printedOn: '',
    printerName: '',
    errorMsg: '',
    updatedAt: nowIso
  };

  avMap[chosenSlot] = job;
  serverDb.viaturaAvarias = avMap;
  return job;
}

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return jsonResponse_({ ok: false, error: 'Requisição vazia.' });
  }
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (eJson) {
    return jsonResponse_({ ok: false, error: 'JSON inválido.' });
  }
  var action = body.action || '';

  // FAST-PATH SEM LOCK E SEM ABRIR PLANILHA/DRIVE: leitura instantânea em RAM (CacheService ~50ms) p/ Servidor de Impressão e Equipes!
  if (action === 'syncDatabase' && !body.pushChanges) {
    var fastCached = readCachedSyncDb_();
    if (fastCached && typeof fastCached === 'object') {
      var propsFast = PropertiesService.getScriptProperties();
      return jsonResponse_({
        ok: true,
        version: 4,
        fastCacheHit: true,
        syncDatabaseReady: true,
        deleteRecordReady: true,
        pushed: false,
        rootFolderUrl: propsFast.getProperty('CACHED_ROOT_URL') || '',
        spreadsheetUrl: propsFast.getProperty('CACHED_SS_URL') || '',
        db: body.onlyPrintQueue ? filterDbForPrintQueueOnly_(fastCached) : fastCached
      });
    }
  }

  var lock = LockService.getScriptLock();
  lock.tryLock(25000);
  try {
    // Sincronização unificada em tempo real (usa abertura leve sem SpreadsheetApp quando não há alteração de planilha)
    if (action === 'syncDatabase') {
      return jsonResponse_(handleSyncDatabase_(null, body));
    }

    // Download direto de PDF por driveFileId (sem precisar abrir Planilha Google)
    if (action === 'downloadPdf') {
      var dlId = String(body.driveFileId || '').trim();
      if (!dlId) {
        return jsonResponse_({ ok: false, error: 'Informe driveFileId.' });
      }
      try {
        var dlFile = DriveApp.getFileById(dlId);
        var dlBlob = dlFile.getBlob();
        return jsonResponse_({
          ok: true,
          fileName: dlFile.getName(),
          pdfBase64: Utilities.base64Encode(dlBlob.getBytes())
        });
      } catch (errDl) {
        return jsonResponse_({ ok: false, error: String(errDl && errDl.message ? errDl.message : errDl) });
      }
    }

    var env = ensureEnvironment_();

    if (action === 'ping') {
      migrateExistingPdfsToLinkView_(env);
      return jsonResponse_({
        ok: true,
        version: 4,
        syncDatabaseReady: true,
        deleteRecordReady: true,
        rootFolderUrl: env.rootFolder.getUrl(),
        spreadsheetUrl: env.ss.getUrl()
      });
    }

    if (action === 'login') {
      var user = authenticate_(env.usersSheet, body.username, body.password);
      if (!user) {
        return jsonResponse_({ ok: false, error: 'Usuário ou senha inválidos (ou usuário inativo).' });
      }
      return jsonResponse_({ ok: true, user: sanitizeUser_(user) });
    }

    // Demais rotas exigem autenticação válida (sincroniza automaticamente usuários já aprovados pelo ADM no APK/GitHub)
    var caller = authenticateOrProvision_(env.usersSheet, body, env);
    if (!caller) {
      return jsonResponse_({ ok: false, error: 'Sessão inválida no servidor. Verifique seu login e senha (ou status de aprovação).' });
    }

    if (action === 'listUsers') {
      if (!isCallerAdmin_(caller)) {
        return jsonResponse_({ ok: false, error: 'Apenas Administradores podem gerenciar usuários.' });
      }
      var allUsers = getAllUsers_(env.usersSheet).map(function(u) {
        return {
          username: u.username,
          name: u.name,
          role: u.role,
          councilId: u.councilId,
          active: u.active,
          password: u.password
        };
      });
      return jsonResponse_({ ok: true, users: allUsers });
    }

    if (action === 'saveUser') {
      if (!isCallerAdmin_(caller)) {
        return jsonResponse_({ ok: false, error: 'Apenas Administradores podem cadastrar ou editar usuários.' });
      }
      var saved = upsertUser_(env.usersSheet, body.userData);
      return jsonResponse_({ ok: true, user: saved });
    }

    if (action === 'deleteUser') {
      if (!isCallerAdmin_(caller)) {
        return jsonResponse_({ ok: false, error: 'Apenas Administradores podem remover usuários.' });
      }
      var targetUsername = String(body.username || '').trim().toLowerCase();
      if (targetUsername === String(caller.username).toLowerCase()) {
        return jsonResponse_({ ok: false, error: 'Você não pode excluir seu próprio usuário administrador logado.' });
      }
      deleteUserByUsername_(env.usersSheet, targetUsername);
      return jsonResponse_({ ok: true });
    }

    if (action === 'uploadRecord') {
      var rec = body.record;
      if (!rec || !rec.id || !rec.type) {
        return jsonResponse_({ ok: false, error: 'Dados do registro incompletos.' });
      }
      var driveFileUrl = rec.driveUrl || '';
      var driveFileId = rec.driveFileId || '';

      // Salva o PDF oficial na pasta correspondente do Google Drive
      if (body.pdfBase64) {
        var targetSubfolder = getTargetFolder_(env.rootFolder, rec.type, rec.date || rec.createdAt);
        var cleanBase64 = body.pdfBase64.replace(/^data:application\/pdf;base64,/, '');
        var pdfBytes = Utilities.base64Decode(cleanBase64);
        var fileName = buildPdfFileName_(rec);
        var blob = Utilities.newBlob(pdfBytes, 'application/pdf', fileName);

        // Se já existia um arquivo anterior desse mesmo ID, move o antigo para lixeira para não duplicar
        if (driveFileId) {
          try { DriveApp.getFileById(driveFileId).setTrashed(true); } catch (errOld) {}
        }

        var driveFile = targetSubfolder.createFile(blob);
        // Libera leitura individual por link apenas para este PDF (as pastas e a planilha continuam 100% privadas!)
        try {
          driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (eShare) {}
        driveFileId = driveFile.getId();
        driveFileUrl = driveFile.getUrl();
      }

      var savedMeta = upsertRecord_(env.recordsSheet, rec, caller, driveFileId, driveFileUrl);
      var printQueued = false;
      var printJob = null;
      if (body.autoPrintOpts && body.autoPrintOpts.enabled && (driveFileId || driveFileUrl)) {
        try {
          var serverDbPrint = loadSyncDb_(env);
          printJob = enqueuePrintJobOnServerDb_(serverDbPrint, rec, driveFileId, driveFileUrl, body.autoPrintOpts, caller);
          saveSyncDb_(env, serverDbPrint);
          printQueued = Boolean(printJob);
        } catch (eAutoPrt) {}
      }
      return jsonResponse_({
        ok: true,
        id: rec.id,
        driveFileId: driveFileId,
        driveUrl: driveFileUrl,
        syncedAt: savedMeta.syncedAt,
        printQueued: printQueued,
        printJob: printJob
      });
    }

    if (action === 'deleteRecord') {
      if (!isCallerAdmin_(caller)) {
        return jsonResponse_({ ok: false, error: 'Apenas Administradores podem excluir fichas e check lists.' });
      }
      var delId = String(body.recordId || '').trim();
      if (!delId) {
        return jsonResponse_({ ok: false, error: 'ID do registro não informado.' });
      }
      var delStats = deleteRecordsFromSheetAndDrive_(env, [{
        id: delId,
        driveFileId: String(body.driveFileId || '').trim(),
        driveUrl: String(body.driveUrl || '').trim()
      }]);
      var nowDelIso = new Date().toISOString();
      var serverDbDel = loadSyncDb_(env);
      serverDbDel.deletedRecordsMap = Object.assign({}, serverDbDel.deletedRecordsMap || {});
      serverDbDel.deletedRecordsMap[delId] = {
        deletedAt: nowDelIso,
        deletedBy: caller.username,
        drivePurged: true
      };
      serverDbDel.deletedRecordsMap = pruneMapByTs_(serverDbDel.deletedRecordsMap, 600, function(v) {
        return (v && typeof v === 'object') ? v.deletedAt : v;
      });
      cleanSharedFichasForDeletedRecordServer_(serverDbDel, delId, nowDelIso);
      saveSyncDb_(env, serverDbDel);
      return jsonResponse_({
        ok: true,
        id: delId,
        deletedRows: delStats.deletedRows,
        trashedFiles: delStats.trashedFiles,
        deletedAt: nowDelIso
      });
    }

    if (action === 'listHistory') {
      migrateExistingPdfsToLinkView_(env);
      var syncDbForList = loadSyncDb_(env);
      var records = listRecordsForUser_(env.recordsSheet, caller, (syncDbForList && syncDbForList.deletedRecordsMap) || {});
      return jsonResponse_({
        ok: true,
        records: records,
        rootFolderUrl: env.rootFolder.getUrl(),
        spreadsheetUrl: env.ss.getUrl()
      });
    }

    if (action === 'lookupCpf') {
      var targetCpf = String(body.cpf || '').replace(/\D+/g, '');
      if (targetCpf.length !== 11) {
        return jsonResponse_({ ok: false, error: 'CPF inválido.' });
      }
      var patient = findPatientByCpf_(env.recordsSheet, targetCpf);
      return jsonResponse_({ ok: true, found: Boolean(patient), patient: patient });
    }

    return jsonResponse_({ ok: false, error: 'Ação desconhecida: ' + action });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (eLock) {}
  }
}

/* ======================== ESTRUTURA AUTOMÁTICA ======================== */

function setupEstrutura() {
  var env = ensureEnvironment_();
  Logger.log('Pasta Google Drive: ' + env.rootFolder.getUrl());
  Logger.log('Planilha Banco de Dados: ' + env.ss.getUrl());
}

function ensureRootFolderOnly_() {
  var props = PropertiesService.getScriptProperties();
  var rootFolder = null;
  var savedFolderId = OPTIONAL_ROOT_FOLDER_ID || props.getProperty('ROOT_FOLDER_ID');
  if (savedFolderId) {
    try {
      var f = DriveApp.getFolderById(savedFolderId);
      if (!f.isTrashed()) rootFolder = f;
    } catch (e) {}
  }
  if (!rootFolder) {
    var iter = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
    if (iter.hasNext()) {
      rootFolder = iter.next();
    } else {
      rootFolder = DriveApp.createFolder(ROOT_FOLDER_NAME);
    }
    props.setProperty('ROOT_FOLDER_ID', rootFolder.getId());
  }
  return rootFolder;
}

function ensureEnvironment_() {
  var props = PropertiesService.getScriptProperties();
  var rootFolder = ensureRootFolderOnly_();

  // Garante as 3 pastas principais apenas na primeira configuração
  if (!props.getProperty('SUBFOLDERS_READY_V1')) {
    getOrCreateSubfolder_(rootFolder, 'Fichas de Atendimento');
    getOrCreateSubfolder_(rootFolder, 'Check List - Condutor Socorrista');
    getOrCreateSubfolder_(rootFolder, 'Check List - Enfermagem');
    props.setProperty('SUBFOLDERS_READY_V1', '1');
  }

  // Obtém ou cria a Planilha Google de banco de dados
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (!ss) {
    var savedSsId = props.getProperty('DB_SPREADSHEET_ID');
    if (savedSsId) {
      try { ss = SpreadsheetApp.openById(savedSsId); } catch (e2) {}
    }
  }
  if (!ss) {
    var filesIter = rootFolder.getFilesByName(DB_SHEET_NAME);
    if (filesIter.hasNext()) {
      ss = SpreadsheetApp.open(filesIter.next());
    } else {
      ss = SpreadsheetApp.create(DB_SHEET_NAME);
      var ssFile = DriveApp.getFileById(ss.getId());
      rootFolder.addFile(ssFile);
      try { DriveApp.getRootFolder().removeFile(ssFile); } catch (eMove) {}
    }
    props.setProperty('DB_SPREADSHEET_ID', ss.getId());
  }

  try {
    if (!props.getProperty('CACHED_ROOT_URL')) props.setProperty('CACHED_ROOT_URL', rootFolder.getUrl());
    if (!props.getProperty('CACHED_SS_URL')) props.setProperty('CACHED_SS_URL', ss.getUrl());
  } catch (eUrls) {}

  var usersSheet = ensureUsersSheet_(ss);
  var recordsSheet = ensureRecordsSheet_(ss);

  return {
    rootFolder: rootFolder,
    ss: ss,
    usersSheet: usersSheet,
    recordsSheet: recordsSheet
  };
}

function getOrCreateSubfolder_(parent, name) {
  var iter = parent.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent.createFolder(name);
}

function getTargetFolder_(rootFolder, type, dateStr) {
  var typeFolderName = 'Fichas de Atendimento';
  if (type === 'checklist_condutor') {
    typeFolderName = 'Check List - Condutor Socorrista';
  } else if (type === 'checklist_enfermagem') {
    typeFolderName = 'Check List - Enfermagem';
  }
  var typeFolder = getOrCreateSubfolder_(rootFolder, typeFolderName);
  var ym = extractYearMonth_(dateStr);
  return getOrCreateSubfolder_(typeFolder, ym);
}

function extractYearMonth_(dateStr) {
  if (dateStr && /^\d{4}-\d{2}/.test(dateStr)) {
    return dateStr.substring(0, 7);
  }
  if (dateStr && /^\d{2}\/\d{2}\/\d{4}/.test(dateStr)) {
    var parts = dateStr.substring(0, 10).split('/');
    return parts[2] + '-' + parts[1];
  }
  var now = new Date();
  var m = ('0' + (now.getMonth() + 1)).slice(-2);
  return now.getFullYear() + '-' + m;
}

function buildPdfFileName_(rec) {
  var d = (rec.date || '').replace(/\//g, '-') || new Date().toISOString().slice(0, 10);
  var safe = function(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 45);
  };
  if (rec.type === 'ficha') {
    var paciente = safe(rec.patientName || 'Sem_Nome');
    return 'Ficha_SAMU_' + d + '_' + paciente + '_' + rec.id.slice(-5) + '.pdf';
  }
  if (rec.type === 'checklist_condutor') {
    var viat = safe(rec.vehicle || 'Viatura');
    var cond = safe(rec.createdByName || rec.createdBy || 'Condutor');
    return 'CheckList_Condutor_' + d + '_' + viat + '_' + cond + '.pdf';
  }
  var enf = safe(rec.createdByName || rec.createdBy || 'Enfermagem');
  return 'CheckList_Enfermagem_' + d + '_' + enf + '_' + rec.id.slice(-5) + '.pdf';
}

/* ======================== USUÁRIOS E PERFIS ======================== */

function ensureUsersSheet_(ss) {
  var sh = ss.getSheetByName('Usuarios');
  if (!sh) {
    sh = ss.insertSheet('Usuarios');
    sh.getRange(1, 1, 200, 7).setNumberFormat('@');
    var now = new Date().toISOString();
    var initRows = [
      ['username', 'password', 'name', 'role', 'councilId', 'active', 'updatedAt'],
      ['admin', 'samu192', 'Coordenação SAMU Orlândia', 'admin', 'ADM-192', 'TRUE', now],
      ['condutor', '1234', 'Condutor Socorrista 01', 'condutor', 'COND-01', 'TRUE', now],
      ['condutor2', '1234', 'Condutor Socorrista 02', 'condutor', 'COND-02', 'TRUE', now],
      ['enfermagem', '1234', 'Técnico de Enfermagem 01', 'enfermagem', 'COREN-SP 542.810-TE', 'TRUE', now],
      ['enfermeiro', '1234', 'Enfermeiro(a) 01', 'enfermagem', 'COREN-SP 318.420-ENF', 'TRUE', now]
    ];
    sh.getRange(1, 1, initRows.length, 7).setValues(initRows);
    sh.getRange(1, 1, 1, 7).setFontWeight('bold');
  }
  return sh;
}

function getAllUsers_(sh) {
  var values = sh.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var uname = String(row[0] || '').trim();
    if (!uname) continue;
    var activeVal = String(row[5]).toUpperCase();
    list.push({
      rowIndex: i + 1,
      username: uname,
      password: String(row[1] || ''),
      name: String(row[2] || uname),
      role: String(row[3] || 'condutor').trim().toLowerCase(),
      councilId: String(row[4] || ''),
      active: !(activeVal === 'FALSE' || activeVal === '0' || activeVal === 'NAO' || activeVal === 'NÃO')
    });
  }
  return list;
}

function passwordsMatchFlexible_(sheetPass, incomingPass) {
  var sp = String(sheetPass || '');
  var ip = String(incomingPass || '');
  if (!ip) return false;
  if (sp === ip) return true;
  if (/^0+\d+$/.test(ip) && sp === (ip.replace(/^0+/, '') || '0')) return true;
  return false;
}

function findActiveUserInSyncDb_(env, usernameLower) {
  try {
    var syncDb = readCachedSyncDb_() || (env ? loadSyncDb_(env) : null);
    if (!syncDb || !Array.isArray(syncDb.users)) return null;
    for (var i = 0; i < syncDb.users.length; i++) {
      var su = syncDb.users[i];
      if (!su || !su.username) continue;
      if (String(su.username).trim().toLowerCase() === usernameLower) {
        if (su.status === 'pending' || su.status === 'rejected' || su.active === false) return null;
        return su;
      }
    }
  } catch (eDb) {}
  return null;
}

function authenticate_(sh, username, password) {
  var u = String(username || '').trim().toLowerCase();
  var p = String(password || '');
  if (!u || !p) return null;
  var users = getAllUsers_(sh);
  for (var i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === u && passwordsMatchFlexible_(users[i].password, p) && users[i].active) {
      return users[i];
    }
  }
  return null;
}

var VALID_USER_ROLES = [
  'admin',
  'condutor',
  'enfermagem',
  'enfermeiro',
  'tecnico',
  'condutor_admin',
  'enfermeiro_admin',
  'tecnico_admin'
];

function isCallerAdmin_(u) {
  var r = String((u && u.role) || '').trim().toLowerCase();
  return r === 'admin' || r === 'condutor_admin' || r === 'enfermeiro_admin' || r === 'tecnico_admin';
}

function normalizeSheetRole_(rawRole) {
  var r = String(rawRole || '').trim().toLowerCase();
  if (VALID_USER_ROLES.indexOf(r) !== -1) return r;
  return 'condutor';
}

function authenticateOrProvision_(sh, body, env) {
  var u = String((body && body.authUser) || '').trim().toLowerCase();
  var p = String((body && body.authPass) || '');
  if (!u || !p) return null;

  var incomingRoleRaw = String((body && body.authRole) || '').trim().toLowerCase();
  var hasIncomingValidRole = incomingRoleRaw && VALID_USER_ROLES.indexOf(incomingRoleRaw) !== -1;

  var users = getAllUsers_(sh);
  for (var i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === u) {
      if (users[i].active && passwordsMatchFlexible_(users[i].password, p)) {
        if (users[i].password !== p) {
          sh.getRange(users[i].rowIndex, 2).setNumberFormat('@').setValue(p);
          users[i].password = p;
        }
        // Mantém o cargo na Planilha sincronizado caso o ADM tenha promovido/alterado o perfil no APK/GitHub
        if (hasIncomingValidRole && users[i].role !== incomingRoleRaw) {
          users[i].role = incomingRoleRaw;
          sh.getRange(users[i].rowIndex, 4).setNumberFormat('@').setValue(incomingRoleRaw);
          sh.getRange(users[i].rowIndex, 7).setNumberFormat('@').setValue(new Date().toISOString());
        }
        return users[i];
      }

      // Auto-cura: verifica se a senha/status já foi atualizada em base_dados_samu_drive.json (syncDatabase)
      var syncedU = findActiveUserInSyncDb_(env, u);
      if (syncedU && passwordsMatchFlexible_(syncedU.password, p)) {
        var healedRole = hasIncomingValidRole ? incomingRoleRaw : profileChoiceFromUserObj_(syncedU);
        var healedName = String(syncedU.name || (body && body.authName) || users[i].name || u);
        var healedCouncil = String(syncedU.coren || syncedU.councilId || (body && body.authCouncilId) || users[i].councilId || '');
        var healedPass = String(syncedU.password || p);
        var healedNow = new Date().toISOString();
        sh.getRange(users[i].rowIndex, 1, 1, 7).setNumberFormat('@').setValues([[
          u,
          healedPass,
          healedName,
          healedRole,
          healedCouncil,
          'TRUE',
          healedNow
        ]]);
        return {
          rowIndex: users[i].rowIndex,
          username: u,
          password: healedPass,
          name: healedName,
          role: healedRole,
          councilId: healedCouncil,
          active: true
        };
      }
      return null;
    }
  }

  // Usuário novo aprovado/criado pelo ADM via APK/GitHub: cadastra automaticamente na planilha em formato texto puro
  var safeRole = hasIncomingValidRole ? incomingRoleRaw : 'condutor';
  var safeName = String((body && body.authName) || u).trim() || u;
  var safeCouncil = String((body && body.authCouncilId) || '').trim();
  var now = new Date().toISOString();
  var nextRow = sh.getLastRow() + 1;
  sh.getRange(nextRow, 1, 1, 7).setNumberFormat('@').setValues([[u, p, safeName, safeRole, safeCouncil, 'TRUE', now]]);
  return {
    username: u,
    password: p,
    name: safeName,
    role: safeRole,
    councilId: safeCouncil,
    active: true
  };
}

function sanitizeUser_(u) {
  return {
    username: u.username,
    name: u.name,
    role: u.role,
    councilId: u.councilId,
    active: u.active
  };
}

function upsertUser_(sh, userData) {
  var uname = String((userData && userData.username) || '').trim().toLowerCase();
  if (!uname) throw new Error('Informe o login do usuário.');
  var users = getAllUsers_(sh);
  var now = new Date().toISOString();
  var role = normalizeSheetRole_(userData.role || 'condutor');
  var activeStr = (userData.active === false) ? 'FALSE' : 'TRUE';
  var councilVal = String(userData.councilId || userData.coren || '');

  for (var i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === uname) {
      var pass = (userData.password && String(userData.password).trim() !== '')
        ? String(userData.password)
        : users[i].password;
      sh.getRange(users[i].rowIndex, 1, 1, 7).setNumberFormat('@').setValues([[
        uname,
        pass,
        String(userData.name || users[i].name),
        role,
        councilVal,
        activeStr,
        now
      ]]);
      return { username: uname, name: userData.name, role: role, councilId: councilVal, active: activeStr === 'TRUE' };
    }
  }

  var newPass = String(userData.password || '1234');
  var nextRow = sh.getLastRow() + 1;
  sh.getRange(nextRow, 1, 1, 7).setNumberFormat('@').setValues([[
    uname,
    newPass,
    String(userData.name || uname),
    role,
    councilVal,
    activeStr,
    now
  ]]);
  return { username: uname, name: userData.name || uname, role: role, councilId: councilVal, active: activeStr === 'TRUE' };
}

function deleteUserByUsername_(sh, targetUsername) {
  var users = getAllUsers_(sh);
  for (var i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === targetUsername) {
      if (isCallerAdmin_(users[i]) && users[i].active) {
        var otherAdmins = users.filter(function(x) {
          return x.username.toLowerCase() !== targetUsername && x.active && isCallerAdmin_(x);
        });
        if (!otherAdmins.length) {
          throw new Error('Não é possível excluir o único login com permissão de ADM.');
        }
      }
      sh.deleteRow(users[i].rowIndex);
      return;
    }
  }
}

/* ======================== HISTÓRICO E PERMISSÕES ======================== */

function ensureRecordsSheet_(ss) {
  var sh = ss.getSheetByName('Registros');
  if (!sh) {
    sh = ss.insertSheet('Registros');
    sh.appendRow([
      'id', 'type', 'date', 'createdAt', 'syncedAt',
      'createdBy', 'createdByName', 'createdByRole',
      'patientName', 'patientCpf', 'risk', 'incidentType',
      'vehicle', 'shift', 'summary',
      'driveFileId', 'driveUrl', 'dataJson'
    ]);
    sh.getRange(1, 1, 1, 18).setFontWeight('bold');
  }
  return sh;
}

function upsertRecord_(sh, rec, caller, driveFileId, driveFileUrl) {
  var syncedAt = new Date().toISOString();
  var callerAdm = isCallerAdmin_(caller);
  var ownerUser = (callerAdm && rec.createdBy) ? rec.createdBy : caller.username;
  var ownerName = (callerAdm && rec.createdByName) ? rec.createdByName : caller.name;
  var ownerRole = (callerAdm && rec.createdByRole) ? rec.createdByRole : caller.role;

  var rowValues = [
    String(rec.id),
    String(rec.type || 'ficha'),
    String(rec.date || ''),
    String(rec.createdAt || syncedAt),
    syncedAt,
    String(ownerUser),
    String(ownerName),
    String(ownerRole),
    String(rec.patientName || ''),
    String(rec.patientCpf || ''),
    String(rec.risk || ''),
    String(rec.incidentType || ''),
    String(rec.vehicle || ''),
    String(rec.shift || ''),
    String(rec.summary || ''),
    String(driveFileId || ''),
    String(driveFileUrl || ''),
    JSON.stringify(rec.data || {})
  ];

  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(rec.id)) {
      sh.getRange(i + 1, 1, 1, 18).setValues([rowValues]);
      return { syncedAt: syncedAt };
    }
  }
  sh.appendRow(rowValues);
  return { syncedAt: syncedAt };
}

function extractDriveFileIdFromUrl_(urlStr) {
  var s = String(urlStr || '').trim();
  if (!s) return '';
  var m1 = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m1 && m1[1]) return m1[1];
  var m2 = s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m2 && m2[1]) return m2[1];
  return '';
}

function deleteRecordsFromSheetAndDrive_(env, recordSpecs) {
  var specs = Array.isArray(recordSpecs) ? recordSpecs : [];
  if (!specs.length) return { deletedRows: 0, trashedFiles: 0 };

  var idMap = {};
  var fileIdMap = {};
  specs.forEach(function(sp) {
    if (!sp || !sp.id) return;
    var rid = String(sp.id).trim();
    if (!rid) return;
    idMap[rid] = true;
    var f1 = String(sp.driveFileId || '').trim();
    var f2 = extractDriveFileIdFromUrl_(sp.driveUrl);
    if (f1) fileIdMap[f1] = true;
    if (f2) fileIdMap[f2] = true;
  });

  var deletedRows = 0;
  try {
    var sh = env.recordsSheet;
    var values = sh.getDataRange().getValues();
    for (var i = values.length - 1; i >= 1; i--) {
      var rowId = String(values[i][0] || '').trim();
      if (rowId && idMap[rowId]) {
        var rowFid = String(values[i][15] || '').trim();
        var rowUrlFid = extractDriveFileIdFromUrl_(values[i][16]);
        if (rowFid) fileIdMap[rowFid] = true;
        if (rowUrlFid) fileIdMap[rowUrlFid] = true;
        sh.deleteRow(i + 1);
        deletedRows++;
      }
    }
  } catch (eSheet) {}

  var trashedFiles = 0;
  Object.keys(fileIdMap).forEach(function(fid) {
    if (!fid) return;
    try {
      var f = DriveApp.getFileById(fid);
      try {
        f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      } catch (ePriv) {}
      f.setTrashed(true);
      trashedFiles++;
    } catch (eFile) {}
  });

  return { deletedRows: deletedRows, trashedFiles: trashedFiles };
}

function listRecordsForUser_(sh, caller, deletedRecordsMap) {
  var delMap = deletedRecordsMap || {};
  var values = sh.getDataRange().getValues();
  var out = [];
  var isAdmin = isCallerAdmin_(caller);
  var callerLower = caller.username.toLowerCase();

  for (var i = values.length - 1; i >= 1; i--) {
    var r = values[i];
    if (!r[0]) continue;
    var recIdStr = String(r[0]);
    if (delMap[recIdStr]) continue;
    var recOwner = String(r[5] || '').toLowerCase();
    // Regra de privacidade: Condutor e Técnico só recebem o próprio histórico; Adm recebe tudo
    if (!isAdmin && recOwner !== callerLower) {
      continue;
    }
    var parsedData = {};
    try { parsedData = r[17] ? JSON.parse(String(r[17])) : {}; } catch (e) {}

    out.push({
      id: String(r[0]),
      type: String(r[1]),
      date: String(r[2]),
      createdAt: String(r[3]),
      syncedAt: String(r[4]),
      createdBy: String(r[5]),
      createdByName: String(r[6]),
      createdByRole: String(r[7]),
      patientName: String(r[8]),
      patientCpf: String(r[9]),
      risk: String(r[10]),
      incidentType: String(r[11]),
      vehicle: String(r[12]),
      shift: String(r[13]),
      summary: String(r[14]),
      driveFileId: String(r[15]),
      driveUrl: String(r[16]),
      syncStatus: 'synced',
      data: parsedData
    });
  }
  return out;
}

function findPatientByCpf_(sh, cleanCpf) {
  var values = sh.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    var r = values[i];
    if (String(r[1]) !== 'ficha') continue;
    var rowCpf = String(r[9] || '').replace(/\D+/g, '');
    if (rowCpf === cleanCpf) {
      var d = {};
      try { d = r[17] ? JSON.parse(String(r[17])) : {}; } catch (e) {}
      return {
        vitimaNome: d.vitimaNome || String(r[8] || ''),
        vitimaIdade: d.vitimaIdade || '',
        vitimaDn: d.vitimaDn || '',
        vitimaCpf: d.vitimaCpf || String(r[9] || ''),
        vitimaRg: d.vitimaRg || '',
        vitimaCns: d.vitimaCns || '',
        vitimaEndereco: d.vitimaEndereco || '',
        vitimaNumero: d.vitimaNumero || '',
        vitimaBairro: d.vitimaBairro || '',
        vitimaCidade: d.vitimaCidade || '',
        vitimaCep: d.vitimaCep || '',
        vitimaNaturalidade: d.vitimaNaturalidade || '',
        vitimaPai: d.vitimaPai || '',
        vitimaMae: d.vitimaMae || '',
        antecedentes: d.antecedentes || [],
        medicamentosSelecionados: d.medicamentosSelecionados || [],
        medicamentosOutro: d.medicamentosOutro || '',
        alergiasSelecionadas: d.alergiasSelecionadas || [],
        alergiasOutro: d.alergiasOutro || ''
      };
    }
  }
  return null;
}

/* ======================== PERMISSÃO DE LINK NOS PDFS JÁ ENVIADOS ======================== */

function migrateExistingPdfsToLinkView_(env) {
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('PDF_LINK_VIEW_MIGRATED_V1') === '1') return;
    var values = env.recordsSheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      var fid = String(values[i][15] || '').trim();
      if (fid) {
        try {
          DriveApp.getFileById(fid).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (eFile) {}
      }
    }
    props.setProperty('PDF_LINK_VIEW_MIGRATED_V1', '1');
  } catch (eMig) {}
}

/* ======================== MOTOR DE SINCRONIZAÇÃO EM TEMPO REAL (ZERO TOKEN) ======================== */

var SYNC_DB_FILENAME = 'base_dados_samu_drive.json';
var SYNC_CACHE_CHUNK_LEN = 38000;

function readCachedSyncDb_() {
  try {
    var cache = CacheService.getScriptCache();
    var metaStr = cache.get('samu_sync_meta_v2');
    if (!metaStr) return null;
    var meta = JSON.parse(metaStr);
    var count = Number(meta.chunks) || 0;
    if (count <= 0 || count > 30) return null;
    var keys = [];
    for (var i = 0; i < count; i++) keys.push('samu_sync_c_' + i);
    var got = cache.getAll(keys);
    var parts = [];
    for (var j = 0; j < count; j++) {
      var k = 'samu_sync_c_' + j;
      if (!got[k]) return null;
      parts.push(got[k]);
    }
    return JSON.parse(parts.join(''));
  } catch (e) {
    return null;
  }
}

function writeCachedSyncDb_(jsonStr) {
  try {
    if (!jsonStr || jsonStr.length > 1000000) return;
    var cache = CacheService.getScriptCache();
    var chunksCount = Math.ceil(jsonStr.length / SYNC_CACHE_CHUNK_LEN) || 1;
    if (chunksCount > 28) return;
    var payload = {};
    for (var i = 0; i < chunksCount; i++) {
      payload['samu_sync_c_' + i] = jsonStr.slice(i * SYNC_CACHE_CHUNK_LEN, (i + 1) * SYNC_CACHE_CHUNK_LEN);
    }
    payload['samu_sync_meta_v2'] = JSON.stringify({ chunks: chunksCount, ts: new Date().toISOString() });
    cache.putAll(payload, 21600);
  } catch (e) {}
}

function getOrCreateSyncDbFile_(env) {
  var props = PropertiesService.getScriptProperties();
  var savedId = props.getProperty('SYNC_DB_FILE_ID');
  if (savedId) {
    try {
      var f = DriveApp.getFileById(savedId);
      if (!f.isTrashed()) return f;
    } catch (e) {}
  }
  var iter = env.rootFolder.getFilesByName(SYNC_DB_FILENAME);
  if (iter.hasNext()) {
    var existing = iter.next();
    props.setProperty('SYNC_DB_FILE_ID', existing.getId());
    return existing;
  }
  return null;
}

function buildInitialSyncDbFromSheet_(env) {
  var sheetUsers = getAllUsers_(env.usersSheet).map(function(u) {
    var r = String(u.role || 'condutor').toLowerCase();
    var isAdm = isCallerAdmin_({ role: r });
    var opRole = 'condutor';
    var subRole = 'condutor';
    if (r === 'admin') { opRole = 'admin'; subRole = 'admin'; }
    else if (r === 'enfermeiro' || r === 'enfermeiro_admin') { opRole = 'enfermagem'; subRole = 'enfermeiro'; }
    else if (r === 'enfermagem' || r === 'tecnico' || r === 'tecnico_admin') { opRole = 'enfermagem'; subRole = 'tecnico'; }
    return {
      username: String(u.username || '').trim().toLowerCase(),
      password: String(u.password || '1234'),
      name: String(u.name || u.username),
      role: opRole,
      subRole: subRole,
      isAdmin: isAdm,
      cpf: '',
      coren: opRole === 'enfermagem' ? String(u.councilId || '') : '',
      councilId: String(u.councilId || ''),
      savedSignature: '',
      status: u.active ? 'approved' : 'pending',
      active: Boolean(u.active),
      updatedAt: '2026-01-01T00:00:00.000Z'
    };
  });

  return {
    schemaVersion: 3,
    system: 'SAMU 192 - Orlandia-SP',
    defaultHospital: 'HBSA',
    updatedAt: new Date().toISOString(),
    deletedUsersMap: {},
    deletedUsernames: [],
    deletedRecordsMap: {},
    users: sheetUsers,
    hospitalReceivers: [],
    medicosReguladores: [],
    patients: {},
    viaturaAvarias: {},
    activeCrews: {},
    sharedFichas: {}
  };
}

function loadSyncDb_(env) {
  var cached = readCachedSyncDb_();
  if (cached && typeof cached === 'object') return cached;

  var file = getOrCreateSyncDbFile_(env);
  if (file) {
    try {
      var raw = file.getBlob().getDataAsString('UTF-8');
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        writeCachedSyncDb_(raw);
        return parsed;
      }
    } catch (eParse) {}
  }

  var initial = buildInitialSyncDbFromSheet_(env);
  saveSyncDb_(env, initial);
  return initial;
}

function saveSyncDb_(env, dbObj) {
  dbObj.updatedAt = new Date().toISOString();
  var jsonStr = JSON.stringify(dbObj);
  var file = getOrCreateSyncDbFile_(env);
  if (file) {
    file.setContent(jsonStr);
  } else {
    var created = env.rootFolder.createFile(SYNC_DB_FILENAME, jsonStr, 'application/json');
    PropertiesService.getScriptProperties().setProperty('SYNC_DB_FILE_ID', created.getId());
  }
  writeCachedSyncDb_(jsonStr);
}

function isUserObjAdmin_(u) {
  if (!u) return false;
  if (u.isAdmin === true) return true;
  var r = String(u.role || '').toLowerCase();
  var sr = String(u.subRole || '').toLowerCase();
  return r === 'admin' || sr === 'admin' || /_admin$/.test(r) || /_admin$/.test(sr);
}

function profileChoiceFromUserObj_(u) {
  var adm = isUserObjAdmin_(u);
  var r = String((u && u.role) || 'condutor').toLowerCase();
  var sr = String((u && u.subRole) || '').toLowerCase();
  if (r === 'admin' || sr === 'admin') return 'admin';
  if (r === 'condutor_admin' || (r === 'condutor' && adm)) return 'condutor_admin';
  if (r === 'enfermeiro_admin' || (sr === 'enfermeiro' && adm)) return 'enfermeiro_admin';
  if (r === 'tecnico_admin' || (r === 'enfermagem' && adm)) return 'tecnico_admin';
  if (r === 'condutor') return 'condutor';
  if (sr === 'enfermeiro' || r === 'enfermeiro') return 'enfermeiro';
  return 'tecnico';
}

function syncUsersToSpreadsheetTab_(sh, usersArr) {
  try {
    if (!Array.isArray(usersArr) || !usersArr.length) return;
    var now = new Date().toISOString();
    var rows = [['username', 'password', 'name', 'role', 'councilId', 'active', 'updatedAt']];
    for (var i = 0; i < usersArr.length; i++) {
      var u = usersArr[i];
      if (!u || !u.username) continue;
      var activeBool = (u.status !== 'pending' && u.active !== false);
      rows.push([
        String(u.username).trim().toLowerCase(),
        String(u.password || '1234'),
        String(u.name || u.username),
        profileChoiceFromUserObj_(u),
        String(u.coren || u.councilId || ''),
        activeBool ? 'TRUE' : 'FALSE',
        String(u.updatedAt || now)
      ]);
    }
    sh.clearContents();
    sh.getRange(1, 1, rows.length, 7).setNumberFormat('@').setValues(rows);
    sh.getRange(1, 1, 1, 7).setFontWeight('bold');
  } catch (eSyncSh) {}
}

function pruneMapByTs_(mapObj, maxEntries, getTsFn) {
  var keys = Object.keys(mapObj || {});
  if (keys.length <= maxEntries) return mapObj || {};
  keys.sort(function(a, b) {
    var ta = String(getTsFn(mapObj[a]) || '');
    var tb = String(getTsFn(mapObj[b]) || '');
    return tb.localeCompare(ta);
  });
  var out = {};
  for (var i = 0; i < maxEntries; i++) {
    out[keys[i]] = mapObj[keys[i]];
  }
  return out;
}

function mergeSharedFichaDocsServer_(docA, docB, closedSessions) {
  var closed = closedSessions || {};
  var aValid = docA && docA.sessionId && docA.data && !closed[docA.sessionId];
  var bValid = docB && docB.sessionId && docB.data && !closed[docB.sessionId];
  if (!aValid && !bValid) return null;
  if (aValid && !bValid) return docA;
  if (!aValid && bValid) return docB;

  if (docA.sessionId !== docB.sessionId) {
    return String(docB.updatedAt || '') >= String(docA.updatedAt || '') ? docB : docA;
  }

  var baseNewer = String(docB.updatedAt || '') >= String(docA.updatedAt || '');
  var primary = baseNewer ? docB : docA;
  var mergedData = JSON.parse(JSON.stringify(primary.data || {}));
  mergedData.horarios = Object.assign({}, (docA.data && docA.data.horarios) || {}, (docB.data && docB.data.horarios) || {});

  var tsA = docA.fieldTs || {};
  var tsB = docB.fieldTs || {};
  var mergedTs = Object.assign({}, tsA, tsB);
  var allTsKeys = {};
  Object.keys(tsA).forEach(function(k) { allTsKeys[k] = true; });
  Object.keys(tsB).forEach(function(k) { allTsKeys[k] = true; });

  Object.keys(allTsKeys).forEach(function(k) {
    var tA = Number(tsA[k] || 0);
    var tB = Number(tsB[k] || 0);
    mergedTs[k] = Math.max(tA, tB);
    var winner = tB >= tA ? docB.data : docA.data;
    if (!winner) return;
    if (k.indexOf('horarios.') === 0) {
      var hk = k.slice(9);
      if (winner.horarios && winner.horarios[hk] !== undefined) {
        mergedData.horarios[hk] = winner.horarios[hk];
      }
    } else if (winner[k] !== undefined) {
      mergedData[k] = winner[k];
    }
  });

  return {
    sessionId: primary.sessionId,
    recordId: docB.recordId || docA.recordId || '',
    isLoadedRecord: Boolean(docB.isLoadedRecord || docA.isLoadedRecord),
    updatedAt: baseNewer ? docB.updatedAt : docA.updatedAt,
    updatedBy: baseNewer ? docB.updatedBy : docA.updatedBy,
    updatedByName: baseNewer ? docB.updatedByName : docA.updatedByName,
    fieldTs: mergedTs,
    data: mergedData
  };
}

function normalizeDeletedRecordEntryServer_(val, fallbackIso) {
  if (!val) return null;
  if (typeof val === 'string') {
    return {
      deletedAt: val,
      driveFileId: '',
      driveUrl: '',
      deletedBy: '',
      drivePurged: false
    };
  }
  if (typeof val === 'object') {
    return {
      deletedAt: String(val.deletedAt || fallbackIso || new Date().toISOString()),
      driveFileId: String(val.driveFileId || ''),
      driveUrl: String(val.driveUrl || ''),
      deletedBy: String(val.deletedBy || ''),
      drivePurged: Boolean(val.drivePurged)
    };
  }
  return null;
}

function cleanSharedFichasForDeletedRecordServer_(dbObj, delId, delIso) {
  if (!dbObj || !dbObj.sharedFichas || !delId) return;
  var ts = String(delIso || new Date().toISOString());
  Object.keys(dbObj.sharedFichas).forEach(function(cid) {
    var ws = dbObj.sharedFichas[cid];
    if (!ws || typeof ws !== 'object') return;
    if (ws.draftRecords && ws.draftRecords[delId]) {
      delete ws.draftRecords[delId];
      ws.closedDraftIds = Object.assign({}, ws.closedDraftIds || {});
      ws.closedDraftIds[delId] = ts;
      ws.updatedAt = ts;
    }
    if (ws.currentFicha && ws.currentFicha.recordId === delId) {
      if (ws.currentFicha.sessionId) {
        ws.closedSessions = Object.assign({}, ws.closedSessions || {});
        ws.closedSessions[ws.currentFicha.sessionId] = { closedAt: ts, reason: 'deleted_by_admin' };
      }
      ws.currentFicha = null;
      ws.updatedAt = ts;
    }
  });
}

function mergeSyncDatabases_(base, incoming) {
  var out = Object.assign({}, base || {});
  var inc = incoming || {};

  if (inc.defaultHospital && String(inc.defaultHospital).trim()) {
    out.defaultHospital = String(inc.defaultHospital).trim();
  }

  // 0. Tombstones de Fichas e Check Lists excluídos pelo ADM (remove de todos os celulares + Google Drive + Planilha)
  var mergedDelRecs = {};
  var baseDelRecs = out.deletedRecordsMap || {};
  Object.keys(baseDelRecs).forEach(function(rid) {
    var norm = normalizeDeletedRecordEntryServer_(baseDelRecs[rid], out.updatedAt);
    if (norm) mergedDelRecs[rid] = norm;
  });
  var incDelRecs = inc.deletedRecordsMap || {};
  var toPurgeOnDrive = [];
  Object.keys(incDelRecs).forEach(function(rid) {
    var cleanRid = String(rid || '').trim();
    if (!cleanRid) return;
    var incEntry = normalizeDeletedRecordEntryServer_(incDelRecs[rid], inc.updatedAt);
    if (!incEntry) return;
    var curEntry = mergedDelRecs[cleanRid];
    if (!curEntry) {
      mergedDelRecs[cleanRid] = incEntry;
      if (!incEntry.drivePurged) {
        toPurgeOnDrive.push({ id: cleanRid, driveFileId: incEntry.driveFileId, driveUrl: incEntry.driveUrl });
      }
    } else {
      var newerTs = String(incEntry.deletedAt) > String(curEntry.deletedAt) ? incEntry.deletedAt : curEntry.deletedAt;
      var alreadyPurged = Boolean(curEntry.drivePurged);
      mergedDelRecs[cleanRid] = {
        deletedAt: newerTs,
        driveFileId: incEntry.driveFileId || curEntry.driveFileId || '',
        driveUrl: incEntry.driveUrl || curEntry.driveUrl || '',
        deletedBy: incEntry.deletedBy || curEntry.deletedBy || '',
        drivePurged: Boolean(curEntry.drivePurged || incEntry.drivePurged)
      };
      if (!alreadyPurged && !incEntry.drivePurged) {
        toPurgeOnDrive.push({
          id: cleanRid,
          driveFileId: mergedDelRecs[cleanRid].driveFileId,
          driveUrl: mergedDelRecs[cleanRid].driveUrl
        });
      }
    }
  });
  mergedDelRecs = pruneMapByTs_(mergedDelRecs, 600, function(v) { return v && v.deletedAt; });
  out.deletedRecordsMap = mergedDelRecs;
  out._recordsToPurgeOnDrive = toPurgeOnDrive;

  // 1. Tombstones de usuários excluídos
  var mergedDel = Object.assign({}, out.deletedUsersMap || {});
  var incDel = Object.assign({}, inc.deletedUsersMap || {});
  if (Array.isArray(inc.deletedUsernames)) {
    inc.deletedUsernames.forEach(function(u) {
      var k = String(u || '').trim().toLowerCase();
      if (k && !incDel[k]) incDel[k] = inc.updatedAt || '2026-01-02T00:00:00.000Z';
    });
  }
  Object.keys(incDel).forEach(function(u) {
    var k = String(u || '').trim().toLowerCase();
    if (!k) return;
    if (!mergedDel[k] || String(incDel[u]) > String(mergedDel[k])) {
      mergedDel[k] = incDel[u];
    }
  });
  out.deletedUsersMap = mergedDel;
  out.deletedUsernames = Object.keys(mergedDel);

  // 2. Usuários (aprovados + pendentes + cargos híbridos + assinaturas salvas)
  var byUname = {};
  (Array.isArray(out.users) ? out.users : []).forEach(function(u) {
    if (u && u.username) byUname[String(u.username).trim().toLowerCase()] = u;
  });
  var usersChanged = false;
  (Array.isArray(inc.users) ? inc.users : []).forEach(function(ru) {
    if (!ru || !ru.username) return;
    var k = String(ru.username).trim().toLowerCase();
    var cur = byUname[k];
    if (!cur) {
      var delTs = mergedDel[k];
      if (!delTs || String(ru.updatedAt || '') > String(delTs)) {
        byUname[k] = ru;
        usersChanged = true;
      }
    } else if (String(ru.updatedAt || '') >= String(cur.updatedAt || '')) {
      var nextSig = ru.savedSignature || cur.savedSignature || '';
      byUname[k] = Object.assign({}, cur, ru, { username: k, savedSignature: nextSig });
      usersChanged = true;
    } else if (ru.savedSignature && !cur.savedSignature) {
      byUname[k] = Object.assign({}, cur, { savedSignature: ru.savedSignature });
      usersChanged = true;
    }
  });

  Object.keys(mergedDel).forEach(function(uname) {
    var cur = byUname[uname];
    if (cur && String(mergedDel[uname]) >= String(cur.updatedAt || '')) {
      if (isUserObjAdmin_(cur)) {
        var otherAdmins = Object.keys(byUname).filter(function(k) {
          var x = byUname[k];
          return k !== uname && x && x.active !== false && x.status !== 'pending' && isUserObjAdmin_(x);
        });
        if (!otherAdmins.length) return;
      }
      delete byUname[uname];
      usersChanged = true;
    }
  });
  out.users = Object.keys(byUname).map(function(k) { return byUname[k]; });
  out._usersChanged = usersChanged;

  // 3. Recebedores do Hospital
  var recMap = {};
  (Array.isArray(out.hospitalReceivers) ? out.hospitalReceivers : []).forEach(function(r) {
    if (r && r.id) recMap[r.id] = r;
  });
  (Array.isArray(inc.hospitalReceivers) ? inc.hospitalReceivers : []).forEach(function(rr) {
    if (!rr || !rr.nome) return;
    var id = rr.id || String(rr.nome).toLowerCase().replace(/[^a-z0-9]+/g, '_');
    var cur = recMap[id];
    if (!cur || String(rr.updatedAt || '') >= String(cur.updatedAt || '')) {
      var nextCoren = (rr.corenCrm !== undefined) ? String(rr.corenCrm || '').trim() : String((cur && cur.corenCrm) || '').trim();
      if (nextCoren === '__VAZIO__' || nextCoren === '__EXCLUIDO__') nextCoren = '';
      recMap[id] = {
        id: id,
        nome: String(rr.nome).trim(),
        corenCrm: nextCoren,
        hospital: String(rr.hospital || (cur && cur.hospital) || 'HBSA').trim(),
        useCount: Math.max(Number(rr.useCount) || 1, Number((cur && cur.useCount) || 0)),
        updatedAt: rr.updatedAt || new Date().toISOString()
      };
    }
  });
  out.hospitalReceivers = Object.keys(recMap).map(function(k) { return recMap[k]; });

  // 4. Médicos Reguladores
  var medMap = {};
  (Array.isArray(out.medicosReguladores) ? out.medicosReguladores : []).forEach(function(m) {
    if (m && m.id) medMap[m.id] = m;
  });
  (Array.isArray(inc.medicosReguladores) ? inc.medicosReguladores : []).forEach(function(rm) {
    if (!rm) return;
    var nome = typeof rm === 'string' ? rm : (rm.nome || '');
    nome = String(nome).trim();
    if (!nome) return;
    var id = (rm && rm.id) || nome.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    var cur = medMap[id];
    var rTs = (rm && rm.updatedAt) || inc.updatedAt || '2026-01-01T00:00:00.000Z';
    if (!cur || String(rTs) >= String(cur.updatedAt || '')) {
      medMap[id] = {
        id: id,
        nome: nome,
        useCount: Math.max(Number(rm && rm.useCount) || 1, Number((cur && cur.useCount) || 0)),
        updatedAt: rTs
      };
    }
  });
  out.medicosReguladores = Object.keys(medMap).map(function(k) { return medMap[k]; });

  // 5. Pacientes por CPF
  var patMap = Object.assign({}, out.patients || {});
  if (inc.patients && typeof inc.patients === 'object') {
    Object.keys(inc.patients).forEach(function(rawCpf) {
      var cleanCpf = String(rawCpf || '').replace(/\D+/g, '');
      if (cleanCpf.length !== 11) return;
      var rp = inc.patients[rawCpf];
      if (!rp || !rp.vitimaNome) return;
      var lp = patMap[cleanCpf];
      if (!lp || String(rp.updatedAt || '') >= String(lp.updatedAt || '')) {
        patMap[cleanCpf] = Object.assign({}, lp || {}, rp);
      }
    });
  }
  out.patients = patMap;

  // 6. Avarias persistentes por Viatura + Fila de Impressão Remota da Base SAMU (__print_cfg__, __print_agent__, __pjob_00..79)
  var avMap = Object.assign({}, out.viaturaAvarias || {});
  if (inc.viaturaAvarias && typeof inc.viaturaAvarias === 'object') {
    Object.keys(inc.viaturaAvarias).forEach(function(vKey) {
      var rv = inc.viaturaAvarias[vKey];
      if (!rv || typeof rv !== 'object') return;
      var lv = avMap[vKey];
      if (!lv || String(rv.updatedAt || '') >= String(lv.updatedAt || '')) {
        avMap[vKey] = rv;
      }
    });
  }
  out.viaturaAvarias = avMap;

  // 7. Equipes do Plantão
  var cutoff14d = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  var crewsMap = Object.assign({}, out.activeCrews || {});
  if (inc.activeCrews && typeof inc.activeCrews === 'object') {
    Object.keys(inc.activeCrews).forEach(function(cid) {
      var rc = inc.activeCrews[cid];
      if (!rc || !Array.isArray(rc.members)) return;
      var lc = crewsMap[cid];
      if (!lc || String(rc.updatedAt || '') >= String(lc.updatedAt || '')) {
        crewsMap[cid] = rc;
      }
    });
  }
  var cleanCrews = {};
  Object.keys(crewsMap).forEach(function(cid) {
    var c = crewsMap[cid];
    if (c && (c.active !== false || String(c.updatedAt || '') >= cutoff14d)) {
      cleanCrews[cid] = c;
    }
  });
  out.activeCrews = cleanCrews;

  // 8. Fichas Compartilhadas em tempo real + Rascunhos da Equipe
  var cutoff7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  var sharedMap = Object.assign({}, out.sharedFichas || {});
  if (inc.sharedFichas && typeof inc.sharedFichas === 'object') {
    Object.keys(inc.sharedFichas).forEach(function(cid) {
      var rWs = inc.sharedFichas[cid] || {};
      var lWs = sharedMap[cid] || { crewId: cid, closedSessions: {}, draftRecords: {}, closedDraftIds: {} };

      var mergedClosed = Object.assign({}, lWs.closedSessions || {});
      Object.keys(rWs.closedSessions || {}).forEach(function(sid) {
        var rInfo = rWs.closedSessions[sid];
        if (!mergedClosed[sid] || String((rInfo && rInfo.closedAt) || '') > String((mergedClosed[sid] && mergedClosed[sid].closedAt) || '')) {
          mergedClosed[sid] = rInfo;
        }
      });
      mergedClosed = pruneMapByTs_(mergedClosed, 40, function(v) { return v && v.closedAt; });

      var mergedCurrent = mergeSharedFichaDocsServer_(lWs.currentFicha, rWs.currentFicha, mergedClosed);

      var mergedClosedDrafts = Object.assign({}, lWs.closedDraftIds || {});
      Object.keys(rWs.closedDraftIds || {}).forEach(function(did) {
        if (!mergedClosedDrafts[did] || String(rWs.closedDraftIds[did]) > String(mergedClosedDrafts[did])) {
          mergedClosedDrafts[did] = rWs.closedDraftIds[did];
        }
      });
      mergedClosedDrafts = pruneMapByTs_(mergedClosedDrafts, 50, function(v) { return v; });

      var mergedDrafts = Object.assign({}, lWs.draftRecords || {});
      Object.keys(rWs.draftRecords || {}).forEach(function(did) {
        var rDraft = rWs.draftRecords[did];
        if (!rDraft || !rDraft.id) return;
        var lDraft = mergedDrafts[did];
        var rTs = String(rDraft.updatedAt || rDraft.createdAt || '');
        var lTs = lDraft ? String(lDraft.updatedAt || lDraft.createdAt || '') : '';
        if (!lDraft || rTs >= lTs) mergedDrafts[did] = rDraft;
      });
      Object.keys(mergedClosedDrafts).forEach(function(did) {
        var d = mergedDrafts[did];
        if (d) {
          var dTs = String(d.updatedAt || d.createdAt || '');
          if (!dTs || String(mergedClosedDrafts[did]) >= dTs) delete mergedDrafts[did];
        }
      });
      mergedDrafts = pruneMapByTs_(mergedDrafts, 25, function(v) { return v && (v.updatedAt || v.createdAt); });

      var lastKmFinal = lWs.lastKmFinal || '';
      var lastKmUpdatedAt = lWs.lastKmUpdatedAt || '';
      if (rWs.lastKmFinal && String(rWs.lastKmUpdatedAt || '') >= String(lastKmUpdatedAt)) {
        lastKmFinal = String(rWs.lastKmFinal);
        lastKmUpdatedAt = rWs.lastKmUpdatedAt || rWs.updatedAt || '';
      }

      sharedMap[cid] = {
        crewId: cid,
        updatedAt: String(rWs.updatedAt || '') > String(lWs.updatedAt || '') ? rWs.updatedAt : (lWs.updatedAt || new Date().toISOString()),
        lastKmFinal: lastKmFinal,
        lastKmUpdatedAt: lastKmUpdatedAt,
        currentFicha: mergedCurrent,
        closedSessions: mergedClosed,
        draftRecords: mergedDrafts,
        closedDraftIds: mergedClosedDrafts
      };
    });
  }
  var cleanShared = {};
  Object.keys(sharedMap).forEach(function(cid) {
    var ws = sharedMap[cid];
    var isActive = Boolean(cleanCrews[cid] && cleanCrews[cid].active !== false);
    if (ws && (isActive || String(ws.updatedAt || '') >= cutoff7d)) {
      cleanShared[cid] = ws;
    }
  });
  out.sharedFichas = cleanShared;
  Object.keys(out.deletedRecordsMap || {}).forEach(function(delId) {
    var entry = out.deletedRecordsMap[delId];
    cleanSharedFichasForDeletedRecordServer_(out, delId, entry && entry.deletedAt);
  });

  return out;
}

function handleSyncDatabase_(env, body) {
  var props = PropertiesService.getScriptProperties();
  var cached = readCachedSyncDb_();
  var fullEnv = env || null;

  if (!cached && !fullEnv) {
    fullEnv = ensureEnvironment_();
    migrateExistingPdfsToLinkView_(fullEnv);
  } else if (fullEnv) {
    migrateExistingPdfsToLinkView_(fullEnv);
  }

  var serverDb = cached || loadSyncDb_(fullEnv);
  var pushed = false;

  if (body && body.pushChanges && body.clientDb && typeof body.clientDb === 'object') {
    serverDb = mergeSyncDatabases_(serverDb, body.clientDb);
    var shouldSyncSheet = Boolean(serverDb._usersChanged);
    var recordsToPurge = Array.isArray(serverDb._recordsToPurgeOnDrive) ? serverDb._recordsToPurgeOnDrive : [];
    delete serverDb._usersChanged;
    delete serverDb._recordsToPurgeOnDrive;

    if ((recordsToPurge.length > 0 || shouldSyncSheet) && !fullEnv) {
      fullEnv = ensureEnvironment_();
    }

    if (recordsToPurge.length > 0 && fullEnv) {
      deleteRecordsFromSheetAndDrive_(fullEnv, recordsToPurge);
      recordsToPurge.forEach(function(sp) {
        if (sp && sp.id && serverDb.deletedRecordsMap && serverDb.deletedRecordsMap[sp.id]) {
          serverDb.deletedRecordsMap[sp.id].drivePurged = true;
        }
      });
    }

    var syncEnv = fullEnv || { rootFolder: ensureRootFolderOnly_() };
    saveSyncDb_(syncEnv, serverDb);
    if (shouldSyncSheet && fullEnv) {
      syncUsersToSpreadsheetTab_(fullEnv.usersSheet, serverDb.users);
    }
    pushed = true;
  }

  var rootUrl = fullEnv ? fullEnv.rootFolder.getUrl() : (props.getProperty('CACHED_ROOT_URL') || '');
  var ssUrl = fullEnv ? fullEnv.ss.getUrl() : (props.getProperty('CACHED_SS_URL') || '');

  return {
    ok: true,
    version: 4,
    syncDatabaseReady: true,
    deleteRecordReady: true,
    pushed: pushed,
    rootFolderUrl: rootUrl,
    spreadsheetUrl: ssUrl,
    db: (body && body.onlyPrintQueue) ? filterDbForPrintQueueOnly_(serverDb) : serverDb
  };
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
