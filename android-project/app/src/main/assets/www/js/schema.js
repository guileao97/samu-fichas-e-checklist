/* ============================================================================
 * SAMU 192 – ORLÂNDIA-SP | ESQUEMAS E CATÁLOGOS OFICIAIS DOS DOCUMENTOS
 * ============================================================================ */

window.SAMU_SCHEMA = {
  viaturas: [
    { id: 'master_29', label: 'Renault Master 29', placa: 'TIW 4I27', full: 'Renault Master 29 - Placa: TIW 4I27' },
    { id: 'master_133', label: 'Renault Master 133', placa: 'SVZ 4D86', full: 'Renault Master 133 - Placa: SVZ 4D86' },
    { id: 'iveco_46', label: 'Iveco Daily 46', placa: 'EVA 1778', full: 'Iveco Daily 46 - Placa: EVA 1778' },
    { id: 'outra', label: 'Outra Viatura', placa: '', full: 'Outra' }
  ],

  riscos: [
    { id: 'VERMELHA', label: 'VERMELHA', color: '#dc2626', bg: '#fef2f2' },
    { id: 'AMARELA', label: 'AMARELA', color: '#d97706', bg: '#fffbeb' },
    { id: 'VERDE', label: 'VERDE', color: '#16a34a', bg: '#f0fdf4' },
    { id: 'AZUL', label: 'AZUL', color: '#2563eb', bg: '#eff6ff' }
  ],

  locaisOcorrencia: ['RESIDÊNCIA', 'VIA PÚBLICA', 'RODOVIA', 'PS', 'UBS'],

  horariosFicha: [
    { key: 'horaChamado', label: 'HORA CHAMADO', short: 'HORA\nCHAMADO' },
    { key: 'horaTransmissao', label: 'HORA TRANSMISSÃO', short: 'HORA\nTRANSMISSÃO' },
    { key: 'horaSaida', label: 'HORA SAÍDA', short: 'HORA SAÍDA' },
    { key: 'horaChegadaLocal', label: 'H CHEGADA LOCAL', short: 'H CHEGADA\nLOCAL' },
    { key: 'horaSaidaLocal', label: 'H SAÍDA LOCAL', short: 'H SAÍDA LOCAL' },
    { key: 'horaChegadaHospital', label: 'H CHEGADA HOSPITAL', short: 'H CHEGADA\nHOSPITAL' },
    { key: 'horaSaidaHospital', label: 'H SAÍDA HOSPITAL', short: 'H SAÍDA\nHOSPITAL' },
    { key: 'horaRetornoBase', label: 'H RETORNO A BASE', short: 'H RETORNO A\nBASE' }
  ],

  // 3 linhas x 5 colunas exatamente como na Ficha Oficial
  tiposAtendimentoGrid: [
    ['ATROPELAMENTO', 'SUSPEITA IAM', 'QUEIMADURAS', 'PSIQUIÁTRICO', 'TRANSFERÊNCIA'],
    ['ACIDENTE TRANSITO', 'SUSPEITA AVC', 'INTOXICAÇÃO', 'HIPO/HIPERTENSÃO', 'OBSTETRICIA'],
    ['AGRESSÃO', 'QUEDA', 'HIPO / HIPER GLICEMIA', 'ALCOLIZADO', '__OUTRO__']
  ],

  situacoesLocal: ['MORTE ÓBVIA', 'CHAMADO FALSO', 'EVADIU-SE', 'QTA'],

  // Regra dos 9 (Frente e Costas somando 100%)
  burnZones: [
    { id: 'cabeca_frente', label: 'Cabeça (Frente)', pct: 4.5, cx: 0.31, cy: 0.19, rx: 0.055, ry: 0.06 },
    { id: 'tronco_frente', label: 'Tronco (Frente)', pct: 18.0, cx: 0.31, cy: 0.36, rx: 0.085, ry: 0.11 },
    { id: 'braco_dir_frente', label: 'Braço Dir. (Frente)', pct: 4.5, cx: 0.185, cy: 0.39, rx: 0.04, ry: 0.11 },
    { id: 'braco_esq_frente', label: 'Braço Esq. (Frente)', pct: 4.5, cx: 0.435, cy: 0.39, rx: 0.04, ry: 0.11 },
    { id: 'genitalia', label: 'Períneo / Genitália', pct: 1.0, cx: 0.31, cy: 0.48, rx: 0.04, ry: 0.03 },
    { id: 'perna_dir_frente', label: 'Perna Dir. (Frente)', pct: 9.0, cx: 0.265, cy: 0.66, rx: 0.042, ry: 0.16 },
    { id: 'perna_esq_frente', label: 'Perna Esq. (Frente)', pct: 9.0, cx: 0.355, cy: 0.66, rx: 0.042, ry: 0.16 },

    { id: 'cabeca_costas', label: 'Cabeça (Costas)', pct: 4.5, cx: 0.72, cy: 0.19, rx: 0.055, ry: 0.06 },
    { id: 'tronco_costas', label: 'Tronco / Dorso (Costas)', pct: 18.0, cx: 0.72, cy: 0.37, rx: 0.085, ry: 0.12 },
    { id: 'braco_esq_costas', label: 'Braço Esq. (Costas)', pct: 4.5, cx: 0.595, cy: 0.39, rx: 0.04, ry: 0.11 },
    { id: 'braco_dir_costas', label: 'Braço Dir. (Costas)', pct: 4.5, cx: 0.845, cy: 0.39, rx: 0.04, ry: 0.11 },
    { id: 'perna_esq_costas', label: 'Perna Esq. (Costas)', pct: 9.0, cx: 0.675, cy: 0.66, rx: 0.042, ry: 0.16 },
    { id: 'perna_dir_costas', label: 'Perna Dir. (Costas)', pct: 9.0, cx: 0.765, cy: 0.66, rx: 0.042, ry: 0.16 }
  ],

  peleOpcoes: ['CORADA', 'CIANÓTICA', 'QUENTE', 'FRIA', 'ICTÉRIA', 'SUDOREICA'],

  antecedentesOpcoes: ['IAM', 'AVC', 'DIABETES', 'ASMA – BRONQUITE', 'CONVULSÃO', 'HAS', 'CA'],

  // Medicamentos em uso: "Nega" em primeiro e os demais em estrita ordem alfabética
  medicamentosOpcoes: [
    'Nega',
    'AAS / Aspirina',
    'Amitriptilina / Tryptanol',
    'Anlodipino / Norvasc',
    'Beclometasona / Clenil',
    'Clonazepam / Rivotril',
    'Clopidogrel / Plavix',
    'Enalapril / Renitec',
    'Espironolactona / Aldactone',
    'Furosemida / Lasix',
    'Gliclazida / Diamicron',
    'Hidroclorotiazida / Clorana',
    'Insulina / Lantus',
    'Levotiroxina / Puran T4',
    'Losartana / Cozaar',
    'Metformina / Glifage',
    'Metformina / Glifage XR',
    'Metilfenidato / Ritalina',
    'Risperidona / Risperdal',
    'Rosuvastatina / Crestor',
    'Sertralina / Zoloft',
    'Sinvastatina / Zocor',
    'Zolpidem / Stilnox'
  ],

  // Alergias: "Nega" em primeiro e as demais em estrita ordem alfabética
  alergiasOpcoes: [
    'Nega',
    'Amoxicilina / Amoxil',
    'Diclofenaco / Voltaren',
    'Dipirona / Novalgina',
    'Escopolamina / Buscopan',
    'Ibuprofeno / Advil',
    'Nimesulida / Nisulid',
    'Paracetamol / Tylenol',
    'Penicilina / Benzetacil',
    'Penicilina Benzatina / Benzetacil'
  ],

  // 3 linhas x 5 colunas exatamente como na Ficha Oficial
  procedimentosGrid: [
    ['CÂNULA GUEDEL', 'OXIGÊNIO', 'OXIMETRIA', 'ACESSO VENOSO', 'RCP'],
    ['DEA', 'COLAR CERVICAL', 'PRANCHA', 'KED', 'TALAS'],
    ['CONTENSÃO', 'KIT PARTO', 'CURATIVO', 'APOIO USA', '__OUTRO__']
  ],

  setoresHospital: ['ACOLHIMENTO', 'OBSERVAÇÃO', 'PS (Pronto Socorro)', 'EMERGÊNCIA'],

  // ================= CHECK LIST CONDUTOR / SOCORRISTA =================
  condutorLegenda: [
    { code: 'OK', label: 'OK = Normal', color: '#16a34a' },
    { code: 'A', label: 'A = Amassado', color: '#d97706' },
    { code: 'D', label: 'D = Danificado', color: '#dc2626' },
    { code: 'F', label: 'F = Falta', color: '#9333ea' },
    { code: 'Q', label: 'Q = Queimado', color: '#ea580c' },
    { code: 'R', label: 'R = Riscado', color: '#2563eb' }
  ],

  condutorLeftItems: [
    { id: 'c_cadeira_roda', qty: '01', name: 'Cadeira de Roda' },
    { id: 'c_calotas', qty: '04', name: 'Calotas' },
    { id: 'c_capo', qty: '01', name: 'Capô' },
    { id: 'c_celular', qty: '01', name: 'Celular' },
    { id: 'c_cintos_maca', qty: '03', name: 'Cintos da Maca' },
    { id: 'c_cones', qty: '03', name: 'Cones' },
    { id: 'c_doc_viatura', qty: '01', name: 'Documento da Viatura' },
    { id: 'c_estepe', qty: '01', name: 'Estepe / Calibragem' },
    { id: 'c_exaustores', qty: '02', name: 'Exaustores' },
    { id: 'c_extintor', qty: '01', name: 'Extintor' },
    { id: 'c_giroflex', qty: '01', name: 'Giroflex' },
    { id: 'c_maca', qty: '01', name: 'Maca' },
    { id: 'c_macaco', qty: '01', name: 'Macaco / Triângulo' },
    { id: 'c_parachoque_diant', qty: '01', name: 'Para Choque Dianteiro' },
    { id: 'c_parachoque_tras', qty: '01', name: 'Para Choque Traseiro' },
    { id: 'c_parabrisa', qty: '01', name: 'Para-brisa' },
    { id: 'c_vidros_lat', qty: '02', name: 'Vidros Laterais' },
    { id: 'c_pneus_calibragem', qty: '04', name: 'Pneus / Calibragem' },
    { id: 'c_pneu_dd', qty: '01', name: 'Pneu Dianteiro Direito' },
    { id: 'c_pneu_de', qty: '01', name: 'Pneu Dianteiro Esquerdo' },
    { id: 'c_pneu_td', qty: '01', name: 'Pneu Traseiro Direito' },
    { id: 'c_pneu_te', qty: '01', name: 'Pneu Traseiro Esquerdo' },
    { id: 'c_portas_diant', qty: '02', name: 'Portas Dianteiras' },
    { id: 'c_porta_corredica', qty: '01', name: 'Porta Corrediça' },
    { id: 'c_portas_tras', qty: '02', name: 'Portas Traseiras' },
    { id: 'c_pranchas_mont', qty: '02', name: 'Pranchas Montadas' },
    { id: 'c_prancha_inf', qty: '01', name: 'Prancha Infantil Montada' },
    { id: 'c_retrovisor_dir', qty: '01', name: 'Retrovisor Direito' },
    { id: 'c_retrovisor_esq', qty: '01', name: 'Retrovisor Esquerdo' }
  ],

  condutorRightItems: [
    { id: 'c_setas', qty: '04', name: 'Setas' },
    { id: 'c_sirene', qty: '01', name: 'Sirene' },
    { id: 'c_torpedo_o2', qty: '02', name: 'Torpedo de O2' },
    { id: 'c_torpedo_ar', qty: '01', name: 'Torpedo de Ar Comprimido' },
    { id: 'c_farois', qty: '-', name: 'Faróis' },
    { id: 'c_oleo_freio', qty: '-', name: 'Nível de Óleo do Motor e Freio' },
    { id: 'c_parte_eletrica', qty: '-', name: 'Parte Elétrica' },
    { id: 'c_parte_mecanica', qty: '-', name: 'Parte Mecânica' },
    { id: 'c_lataria_dir', qty: '-', name: 'Lataria Direita' },
    { id: 'c_lataria_esq', qty: '-', name: 'Lataria Esquerda' },
    { id: 'c_lanternas', qty: '-', name: 'Lanternas' },
    { id: 'c_limpadores', qty: '-', name: 'Limpadores' },
    { id: 'c_luz_freio', qty: '-', name: 'Luz de Freio' },
    { id: 'c_luz_re', qty: '-', name: 'Luz de Ré' },
    { id: 'c_luzes_internas', qty: '-', name: 'Luzes Internas' },
    { id: 'c_luzes_sinaliz', qty: '-', name: 'Luzes Sinalizadoras' },
    { id: 'c_luzes_foco', qty: '-', name: 'Luzes de Foco (Farolete)' },
    { id: 'c_combustivel', qty: '-', name: 'Nível de Combustível' },
    { id: 'c_radiador', qty: '-', name: 'Radiador / Água / Tampa' },
    { id: 'c_teto', qty: '-', name: 'Teto' }
  ],

  // ================= CHECK LIST ENFERMAGEM (USB) =================
  enfermagemSections: [
    {
      id: 'mochila_verde_clinica',
      title: 'MOCHILA VERDE (CLÍNICA)',
      color: '#15803d',
      page: 1,
      col: 1,
      items: [
        { id: 'mvc_1', qty: '1', name: 'ESPARADRAPO 100MM' },
        { id: 'mvc_2', qty: '1', name: 'MICROPORE 25MM' },
        { id: 'mvc_3', qty: '2', name: 'TORNEIRINHA' },
        { id: 'mvc_4', qty: '1', name: 'SG 500 ML' },
        { id: 'mvc_5', qty: '1', name: 'SF 0,9% 500 ML' },
        { id: 'mvc_6', qty: '2', name: 'CÂNULA PONTA RÍGIDA 24 CM' },
        { id: 'mvc_7', qty: '2', name: 'ATADURA 10 CM' },
        { id: 'mvc_8', qty: '2', name: 'SERINGA 20 ML' },
        { id: 'mvc_9', qty: '2', name: 'ABOCATH 14' },
        { id: 'mvc_10', qty: '2', name: 'ABOCATH 16' },
        { id: 'mvc_11', qty: '2', name: 'ABOCATH 18' },
        { id: 'mvc_12', qty: '2', name: 'ABOCATH 20' },
        { id: 'mvc_13', qty: '2', name: 'ABOCATH 22' },
        { id: 'mvc_14', qty: '2', name: 'ABOCATH 24' },
        { id: 'mvc_15', qty: '2', name: 'EQUIPO' },
        { id: 'mvc_16', qty: '4', name: 'AMPOLA GLICOSE 50%' },
        { id: 'mvc_17', qty: '6', name: 'AGULHA 40X12' },
        { id: 'mvc_18', qty: '6', name: 'AGULHA 30X8' },
        { id: 'mvc_19', qty: '2', name: 'SCALP 25' },
        { id: 'mvc_20', qty: '2', name: 'SCALP 23' },
        { id: 'mvc_21', qty: '1', name: 'SCALP 21' },
        { id: 'mvc_22', qty: '2', name: 'RINGUER LACTATO' }
      ]
    },
    {
      id: 'mochila_vermelha_trauma',
      title: 'MOCHILA VERMELHA (TRAUMA)',
      color: '#b91c1c',
      page: 1,
      col: 2,
      items: [
        { id: 'mvt_1', qty: '1', name: 'COLAR INFANTIL REGULÁVEL' },
        { id: 'mvt_2', qty: '1', name: 'ESPARADRAPO 100 MM' },
        { id: 'mvt_3', qty: '1', name: 'MICROPORE 50 MM' },
        { id: 'mvt_4', qty: '10', name: 'ATADURAS 10CM' },
        { id: 'mvt_5', qty: '10', name: 'ATADURAS 12CM' },
        { id: 'mvt_6', qty: '10', name: 'ATADURAS 15CM' },
        { id: 'mvt_7', qty: '10', name: 'ATADURAS 20CM' },
        { id: 'mvt_8', qty: '1', name: 'LANTERNA' },
        { id: 'mvt_9', qty: '1', name: 'TESOURA' },
        { id: 'mvt_10', qty: '1', name: 'CÂNULA DE GUEDEL 00' },
        { id: 'mvt_11', qty: '1', name: 'CÂNULA DE GUEDEL 01' },
        { id: 'mvt_12', qty: '1', name: 'CÂNULA DE GUEDEL 02' },
        { id: 'mvt_13', qty: '1', name: 'CÂNULA DE GUEDEL 03' },
        { id: 'mvt_14', qty: '1', name: 'CÂNULA PONTA RÍGIDA 24 CM' },
        { id: 'mvt_15', qty: '3', name: 'COMPRESSA CIRURGIA' },
        { id: 'mvt_16', qty: '1', name: 'CÂNULA DE GUEDEL 04' },
        { id: 'mvt_17', qty: '1', name: 'CÂNULA DE GUEDEL 05' },
        { id: 'mvt_18', qty: '2', name: 'MANTA ALUMÍNIO' },
        { id: 'mvt_19', qty: '4', name: 'SF 0,9% 100 ML' },
        { id: 'mvt_20', qty: '10', name: 'PACOTE GAZE' }
      ]
    },
    {
      id: 'mochila_azul_dago',
      title: 'MOCHILA AZUL (DAGO)',
      color: '#1d4ed8',
      page: 1,
      col: 3,
      items: [
        { id: 'mad_1', qty: '1', name: 'AMBU ADULTO' },
        { id: 'mad_2', qty: '1', name: 'DEA' },
        { id: 'mad_3', qty: '1', name: 'PÁ ADULTO' },
        { id: 'mad_4', qty: '1', name: 'PÁ PEDIÁTRICO' },
        { id: 'mad_5', qty: '1', name: 'CÂNULA DE GUEDEL 00' },
        { id: 'mad_6', qty: '1', name: 'CÂNULA DE GUEDEL 01' },
        { id: 'mad_7', qty: '1', name: 'CÂNULA DE GUEDEL 02' },
        { id: 'mad_8', qty: '1', name: 'CÂNULA DE GUEDEL 03' },
        { id: 'mad_9', qty: '1', name: 'CÂNULA DE GUEDEL 04' },
        { id: 'mad_10', qty: '1', name: 'CÂNULA DE GUEDEL 05' }
      ]
    },
    {
      id: 'mochila_verde_oxigenio',
      title: 'MOCHILA VERDE (OXIGÊNIO)',
      color: '#047857',
      page: 1,
      col: 3,
      items: [
        { id: 'mvo_1', qty: '1', name: 'MASCARA DE O2 ADULTO' },
        { id: 'mvo_2', qty: '1', name: 'MASCARA DE O2 INFANTIL' },
        { id: 'mvo_3', qty: '1', name: 'CATETER O2 TP. OCULOS AD.' },
        { id: 'mvo_4', qty: '1', name: 'CATETER O2 TP. OCULOS INFANTIL' },
        { id: 'mvo_5', qty: '1', name: 'CATETER DE O2 Nº 10' },
        { id: 'mvo_6', qty: '1', name: 'SONDA DE ASPIRAÇÃO Nº 08' },
        { id: 'mvo_7', qty: '1', name: 'CILINDRO DE O2 (PP) em libras', customInput: true, placeholder: 'Ex: 150 lb' },
        { id: 'mvo_8', qty: '1', name: 'FLUXOMETRO' }
      ]
    },
    {
      id: 'viatura_enf',
      title: 'VIATURA',
      color: '#334155',
      page: 2,
      col: 1,
      items: [
        { id: 've_1', qty: '2', name: 'PRANCHA ADULTO' },
        { id: 've_2', qty: '1', name: 'PRANCHA INFANTIL' },
        { id: 've_3', qty: '3', name: 'TALA EXG(AMARELA)' },
        { id: 've_4', qty: '3', name: 'TALA G(VERDE)' },
        { id: 've_5', qty: '3', name: 'TALA M(LARANJA)' },
        { id: 've_6', qty: '3', name: 'TALA P(AZUL)' },
        { id: 've_7', qty: '3', name: 'TALA PP(LILÁS)' },
        { id: 've_8', qty: '1', name: 'KIT PARTO' },
        { id: 've_9', qty: '2', name: 'COLAR P' },
        { id: 've_10', qty: '2', name: 'COLAR M' },
        { id: 've_11', qty: '2', name: 'COLAR G' },
        { id: 've_12', qty: '2', name: 'COLAR INFANTIL' },
        { id: 've_13', qty: '1', name: 'COLAR PP' },
        { id: 've_14', qty: '1', name: 'ASPIRADOR FIXO' },
        { id: 've_15', qty: '1', name: 'ASPIRA. BANCADA' },
        { id: 've_16', qty: '1', name: 'FLUXÔMETRO' },
        { id: 've_17', qty: '1', name: 'KED INFANTIL' },
        { id: 've_18', qty: '1', name: 'KED ADULTO' },
        { id: 've_19', qty: '3', name: 'JOGO HEAD BLOCK' },
        { id: 've_20', qty: '1', name: 'CX LUVA P' },
        { id: 've_21', qty: '1', name: 'CX LUVA M' },
        { id: 've_22', qty: '1', name: 'CX LUVA G' },
        { id: 've_23', qty: '1', name: 'CAPA DE CHUVA M' },
        { id: 've_24', qty: '1', name: 'CAPA DE CHUVA G' },
        { id: 've_25', qty: '1', name: 'CAPA DE CHUVA GG' },
        { id: 've_26', qty: '1', name: 'CORDA DA VIDA' },
        { id: 've_27', qty: '5', name: 'FAIXA DE CONTENÇÃO' }
      ]
    },
    {
      id: 'gaveta_1',
      title: 'GAVETA 1',
      color: '#475569',
      page: 2,
      col: 2,
      items: [
        { id: 'g1_1', qty: '1', name: 'ESFIG. INFANTIL' },
        { id: 'g1_2', qty: '1', name: 'CANULA PONTA RÍGIDA 24CM' },
        { id: 'g1_3', qty: '2', name: 'SONDA ASPI. 14' },
        { id: 'g1_4', qty: '2', name: 'SONDA ASPI. 12' },
        { id: 'g1_5', qty: '2', name: 'SONDA ASPI. 10' },
        { id: 'g1_6', qty: '2', name: 'SONDA ASPI. 8' }
      ]
    },
    {
      id: 'gaveta_2',
      title: 'GAVETA 2',
      color: '#475569',
      page: 2,
      col: 2,
      items: [
        { id: 'g2_1', qty: '2', name: 'ATADURA 10 CM' },
        { id: 'g2_2', qty: '5', name: 'ATADURA 15CM' },
        { id: 'g2_3', qty: '5', name: 'ATADURA 20CM' },
        { id: 'g2_4', qty: '2', name: 'SF 0,9% 250 ML' },
        { id: 'g2_5', qty: '1', name: 'BOLSA PUNÇÃO' }
      ]
    },
    {
      id: 'bolsa_sinais_vt',
      title: 'BOLSA SINAIS VT',
      color: '#0f766e',
      page: 2,
      col: 2,
      items: [
        { id: 'bsv_1', qty: '1', name: 'GLICOSÍMETRO(FITAS/LANCETAS)' },
        { id: 'bsv_2', qty: '1', name: 'ESFIG. ADULTO' },
        { id: 'bsv_3', qty: '1', name: 'LANTERNA PEQUENA' },
        { id: 'bsv_4', qty: '1', name: 'ESTETOSCÓPIO' },
        { id: 'bsv_5', qty: '1', name: 'OXÍMETRO' },
        { id: 'bsv_6', qty: '1', name: 'CABO INFANTIL' }
      ]
    },
    {
      id: 'armario_superior',
      title: 'ARMARIO SUPERIOR',
      color: '#6d28d9',
      page: 2,
      col: 3,
      items: [
        { id: 'as_1', qty: '1', name: 'LANTERNA' },
        { id: 'as_2', qty: '1', name: 'SORO RINGUER 500ML' },
        { id: 'as_3', qty: '1', name: 'AMBU INFANTIL' },
        { id: 'as_4', qty: '4', name: 'MÁSCARA O2 ADULTO' },
        { id: 'as_5', qty: '2', name: 'SF 0,9% 500ML' },
        { id: 'as_6', qty: '1', name: 'COLAR P' },
        { id: 'as_7', qty: '1', name: 'COLAR M' },
        { id: 'as_8', qty: '1', name: 'COLAR G' },
        { id: 'as_9', qty: '1', name: 'ALCOOL 70%' },
        { id: 'as_10', qty: '12', name: 'ATADURAS 10 CM' },
        { id: 'as_11', qty: '12', name: 'ATADURAS 15 CM' },
        { id: 'as_12', qty: '12', name: 'ATADURAS 20 CM' },
        { id: 'as_13', qty: '4', name: 'COMPRESSA CIRUR.' },
        { id: 'as_14', qty: '1', name: 'SF NÃO ESTERIL' },
        { id: 'as_15', qty: '1', name: 'LANTERNA DE CABEÇA' },
        { id: 'as_16', qty: '1', name: 'ESFIG. OBESO' },
        { id: 'as_17', qty: '3', name: 'MASCARA DE O2 INFAN.' },
        { id: 'as_18', qty: '5', name: 'CATETER TP. OCULOS AD' },
        { id: 'as_19', qty: '2', name: 'CATETER TP. OCULOS INFAN.' },
        { id: 'as_20', qty: '2', name: 'CATETER TP. OCULOS PEDIA.' }
      ]
    },
    {
      id: 'bolsa_puncao',
      title: 'BOLSA PUNÇÃO',
      color: '#c2410c',
      page: 2,
      col: 4,
      items: [
        { id: 'bp_1', qty: '2', name: 'ABOCATH 18' },
        { id: 'bp_2', qty: '2', name: 'ABOCATH 20' },
        { id: 'bp_3', qty: '2', name: 'ABOCATH 22' },
        { id: 'bp_4', qty: '2', name: 'ABOCATH 24' },
        { id: 'bp_5', qty: '2', name: 'SERINGA 20 ML' },
        { id: 'bp_6', qty: '10', name: 'GLICOSE 50%' },
        { id: 'bp_7', qty: '6', name: 'AGULHA 40X12' },
        { id: 'bp_8', qty: '6', name: 'AGULHA 30X8' },
        { id: 'bp_9', qty: '2', name: 'TORNEIRINHA' },
        { id: 'bp_10', qty: '2', name: 'SCALP 21' },
        { id: 'bp_11', qty: '2', name: 'SCALP 23' },
        { id: 'bp_12', qty: '2', name: 'SCALP 25' },
        { id: 'bp_13', qty: '1', name: 'ESPARADRAPO' },
        { id: 'bp_14', qty: '2', name: 'EQUIPO MACRO' }
      ]
    }
  ]
};
