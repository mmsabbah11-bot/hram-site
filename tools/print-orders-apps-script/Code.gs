/**
 * הרם הנדסה ותחבורה – קליטת הזמנות הדפסה מהאתר (hram.co.il/plan-printing/)
 * Google Apps Script Web App. אין בקובץ סודות: מזהה התיקייה וכתובת ההתראה
 * נשמרים ב-Script Properties של הפרויקט (ראו README.md).
 *
 * פרוטוקול (POST, גוף JSON כ-text/plain):
 *   init   {order}                                   -> יוצר תיקייה להזמנה, שומר order.json + summary.txt
 *   start  {folderId,orderNo,fileIndex,name,size}  -> פותח העלאה מתחדשת (resumable) ל-Drive עבור קובץ
 *   chunk  {folderId,orderNo,fileIndex,index,size,data(base64)} -> מעביר מקטע של 3MB ישירות לקובץ ב-Drive
 *   (הקובץ נבנה ב-Drive עצמו, בלי לאחד מקטעים בזיכרון הסקריפט)
 *   done   {folderId,orderNo,files[]}                -> שולח התראה במייל (אם הוגדר NOTIFY_EMAIL)
 */

var MAX_FILE_MB = 45;            // חייב להתאים ל-CONFIG.MAX_FILE_MB באתר
var CHUNK_BYTES = 3 * 1024 * 1024;  // חייב להתאים ל-CONFIG.CHUNK_BYTES באתר (כפולה של 256KB)
var MAX_FILES = 40;
var ALLOWED_EXT = /\.(pdf|dwf|dwfx)$/i;

function doGet() {
  return json_({ ok: true, service: 'hram-print-orders' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('בקשה ריקה');
    var req = JSON.parse(e.postData.contents);
    switch (req.action) {
      case 'init':   return json_(init_(req));
      case 'chunk':  return json_(chunk_(req));
      case 'start':  return json_(start_(req));
      case 'done':   return json_(done_(req));
      default: throw new Error('פעולה לא מוכרת');
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ---------- פעולות ---------- */

function init_(req) {
  var o = req.order || {};
  var orderNo = cleanOrderNo_(o.orderNo);
  if (!o.name || !o.phone) throw new Error('חסרים שם או טלפון');
  var root = rootFolder_();
  var stamp = Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd HH:mm');
  var folder = root.createFolder(orderNo + ' – ' + clean_(o.name, 60) + ' – ' + stamp);
  o.receivedAt = stamp;
  folder.createFile('order.json', JSON.stringify(o, null, 2), MimeType.PLAIN_TEXT);
  folder.createFile('summary.txt', String(o.summary || ''), MimeType.PLAIN_TEXT);
  return { ok: true, folderId: folder.getId() };
}

function start_(req) {
  var folder = orderFolder_(req.folderId, req.orderNo);
  var fi = int_(req.fileIndex, 0, MAX_FILES - 1), name = checkName_(req.name);
  var size = int_(req.size, 1, MAX_FILE_MB * 1024 * 1024);
  var mime = /\.pdf$/i.test(name) ? 'application/pdf' : 'application/octet-stream';
  var res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
    method: 'post', contentType: 'application/json; charset=UTF-8', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
    payload: JSON.stringify({ name: name, parents: [folder.getId()] })
  });
  var loc = res.getHeaders()['Location'] || res.getHeaders()['location'];
  if (res.getResponseCode() !== 200 || !loc) throw new Error('פתיחת העלאה נכשלה (' + res.getResponseCode() + ')');
  CacheService.getScriptCache().put(key_(folder.getId(), fi), JSON.stringify({ url: loc, size: size }), 21600);
  return { ok: true };
}

function chunk_(req) {
  var folder = orderFolder_(req.folderId, req.orderNo);
  var fi = int_(req.fileIndex, 0, MAX_FILES - 1);
  var s = CacheService.getScriptCache().get(key_(folder.getId(), fi));
  if (!s) throw new Error('העלאה לא נפתחה או פג תוקפה');
  s = JSON.parse(s);
  var total = Math.ceil(s.size / CHUNK_BYTES), index = int_(req.index, 0, total - 1);
  var bytes = Utilities.base64Decode(String(req.data || ''));
  var from = index * CHUNK_BYTES, expect = Math.min(CHUNK_BYTES, s.size - from);
  if (bytes.length !== expect) throw new Error('גודל מקטע לא תקין');
  var res = UrlFetchApp.fetch(s.url, {
    method: 'put', contentType: 'application/octet-stream', muteHttpExceptions: true, payload: bytes,
    headers: { 'Content-Range': 'bytes ' + from + '-' + (from + bytes.length - 1) + '/' + s.size }
  });
  var code = res.getResponseCode();
  var last = index === total - 1;
  if (last ? !(code === 200 || code === 201) : code !== 308) throw new Error('העברת מקטע נכשלה (' + code + ')');
  return { ok: true, complete: last };
}

function done_(req) {
  var folder = orderFolder_(req.folderId, req.orderNo);
  var to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (to) {
    var summary = '';
    var it = folder.getFilesByName('summary.txt');
    if (it.hasNext()) summary = it.next().getBlob().getDataAsString('UTF-8');
    MailApp.sendEmail({
      to: to,
      subject: 'הזמנת הדפסה חדשה ' + cleanOrderNo_(req.orderNo),
      body: summary + '\n\nקבצים שהועלו: ' + (req.files || []).join(', ') + '\nתיקייה: ' + folder.getUrl()
    });
  }
  return { ok: true };
}

/* ---------- עזר ---------- */

function rootFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty('FOLDER_ID');
  if (!id) throw new Error('השירות לא הוגדר (FOLDER_ID חסר)');
  return DriveApp.getFolderById(id);
}

function orderFolder_(folderId, orderNo) {
  var rootId = rootFolder_().getId();
  var f = DriveApp.getFolderById(String(folderId || ''));
  var parents = f.getParents(), ok = false;
  while (parents.hasNext()) if (parents.next().getId() === rootId) ok = true;
  if (!ok || f.getName().indexOf(cleanOrderNo_(orderNo)) !== 0) throw new Error('תיקיית הזמנה לא תקינה');
  return f;
}

function cleanOrderNo_(s) {
  s = String(s || '');
  if (!/^HP-\d{6}-\d{4}$/.test(s)) throw new Error('מספר הזמנה לא תקין');
  return s;
}
function checkName_(n) {
  n = clean_(n, 150);
  if (!ALLOWED_EXT.test(n)) throw new Error('סוג קובץ לא נתמך (PDF/DWF בלבד)');
  return n;
}
function clean_(s, max) { return String(s || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, max); }
function int_(v, min, max) { v = parseInt(v, 10); if (isNaN(v) || v < min || v > max) throw new Error('ערך לא תקין'); return v; }
function key_(folderId, fi) { return 'up_' + folderId + '_' + fi; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
