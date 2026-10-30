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

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'ping';
  if (action === 'ping') {
    var env = ensureEnvironment_();
    return jsonResponse_({
      ok: true,
      service: 'SAMU 192 Orlândia - Google Drive Sync',
      rootFolderUrl: env.rootFolder.getUrl(),
      spreadsheetUrl: env.ss.getUrl(),
      timestamp: new Date().toISOString()
    });
  }
  return jsonResponse_({ ok: false, error: 'Use POST para operações de dados.' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(25000);
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ ok: false, error: 'Requisição vazia.' });
    }
    var body = JSON.parse(e.postData.contents);
    var action = body.action || '';
    var env = ensureEnvironment_();

    if (action === 'ping') {
      return jsonResponse_({
        ok: true,
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

    // Demais rotas exigem autenticação válida
    var caller = authenticate_(env.usersSheet, body.authUser, body.authPass);
    if (!caller) {
      return jsonResponse_({ ok: false, error: 'Sessão inválida no servidor. Verifique seu login e senha.' });
    }

    if (action === 'listUsers') {
      if (caller.role !== 'admin') {
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
      if (caller.role !== 'admin') {
        return jsonResponse_({ ok: false, error: 'Apenas Administradores podem cadastrar ou editar usuários.' });
      }
      var saved = upsertUser_(env.usersSheet, body.userData);
      return jsonResponse_({ ok: true, user: saved });
    }

    if (action === 'deleteUser') {
      if (caller.role !== 'admin') {
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
        driveFileId = driveFile.getId();
        driveFileUrl = driveFile.getUrl();
      }

      var savedMeta = upsertRecord_(env.recordsSheet, rec, caller, driveFileId, driveFileUrl);
      return jsonResponse_({
        ok: true,
        id: rec.id,
        driveFileId: driveFileId,
        driveUrl: driveFileUrl,
        syncedAt: savedMeta.syncedAt
      });
    }

    if (action === 'listHistory') {
      var records = listRecordsForUser_(env.recordsSheet, caller);
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

function ensureEnvironment_() {
  var props = PropertiesService.getScriptProperties();
  var rootFolder = null;
  var savedFolderId = props.getProperty('ROOT_FOLDER_ID');
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

  // Garante as 3 pastas principais
  getOrCreateSubfolder_(rootFolder, 'Fichas de Atendimento');
  getOrCreateSubfolder_(rootFolder, 'Check List - Condutor Socorrista');
  getOrCreateSubfolder_(rootFolder, 'Check List - Enfermagem');

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
    sh.appendRow(['username', 'password', 'name', 'role', 'councilId', 'active', 'updatedAt']);
    sh.getRange(1, 1, 1, 7).setFontWeight('bold');
    var now = new Date().toISOString();
    sh.appendRow(['admin', 'samu192', 'Coordenação SAMU Orlândia', 'admin', 'ADM-192', 'TRUE', now]);
    sh.appendRow(['condutor', '1234', 'Condutor Socorrista 01', 'condutor', 'COND-01', 'TRUE', now]);
    sh.appendRow(['enfermagem', '1234', 'Técnico de Enfermagem 01', 'enfermagem', 'COREN-SP', 'TRUE', now]);
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

function authenticate_(sh, username, password) {
  var u = String(username || '').trim().toLowerCase();
  var p = String(password || '');
  if (!u || !p) return null;
  var users = getAllUsers_(sh);
  for (var i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === u && users[i].password === p && users[i].active) {
      return users[i];
    }
  }
  return null;
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
  var role = String(userData.role || 'condutor').toLowerCase();
  if (['admin', 'condutor', 'enfermagem'].indexOf(role) === -1) role = 'condutor';
  var activeStr = (userData.active === false) ? 'FALSE' : 'TRUE';

  for (var i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === uname) {
      var pass = (userData.password && String(userData.password).trim() !== '')
        ? String(userData.password)
        : users[i].password;
      sh.getRange(users[i].rowIndex, 1, 1, 7).setValues([[
        uname,
        pass,
        String(userData.name || users[i].name),
        role,
        String(userData.councilId || ''),
        activeStr,
        now
      ]]);
      return { username: uname, name: userData.name, role: role, councilId: userData.councilId || '', active: activeStr === 'TRUE' };
    }
  }

  var newPass = String(userData.password || '1234');
  sh.appendRow([
    uname,
    newPass,
    String(userData.name || uname),
    role,
    String(userData.councilId || ''),
    activeStr,
    now
  ]);
  return { username: uname, name: userData.name || uname, role: role, councilId: userData.councilId || '', active: activeStr === 'TRUE' };
}

function deleteUserByUsername_(sh, targetUsername) {
  var users = getAllUsers_(sh);
  for (var i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === targetUsername) {
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
  var ownerUser = (caller.role === 'admin' && rec.createdBy) ? rec.createdBy : caller.username;
  var ownerName = (caller.role === 'admin' && rec.createdByName) ? rec.createdByName : caller.name;
  var ownerRole = (caller.role === 'admin' && rec.createdByRole) ? rec.createdByRole : caller.role;

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

function listRecordsForUser_(sh, caller) {
  var values = sh.getDataRange().getValues();
  var out = [];
  var isAdmin = (caller.role === 'admin');
  var callerLower = caller.username.toLowerCase();

  for (var i = values.length - 1; i >= 1; i--) {
    var r = values[i];
    if (!r[0]) continue;
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

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
