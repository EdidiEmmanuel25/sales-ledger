(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'quick-sales-ledger-v1';
  var TAB_KEY = 'quick-sales-ledger-tab';
  var CODE = '99887733';
  var AUTO_HIDE_MS = 120000;
  var MASK = '₦ ••••••';
  var METHODS = [
    { key: 'POS', hot: ['p', '1'] },
    { key: 'Transfer', hot: ['t', '2'] },
    { key: 'Cash', hot: ['c', '3'] }
  ];
  var DEFAULT_AMOUNTS = [500, 1000, 2000, 3000, 5000, 10000, 20000, 50000];
  var DEFAULT_OPENINGS = [5000, 10000, 20000, 50000, 100000];
  var DEFAULT_EXPENSES = ['Transport', 'Fuel', 'Food', 'Airtime', 'Supplies', 'Cleaning', 'Repairs', 'Wages'];
  var TABS = ['sales', 'expenses', 'counter', 'report'];
  var SHOP_KEY = 'quick-sales-ledger-shop';
  var CAN_PRINT = !(window.claude && window.claude.use);

  var nf = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 });
  function fmt(n) { return n < 0 ? '−₦' + nf.format(-n) : '₦' + nf.format(n); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function timeOf(ts) { return new Date(ts).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' }); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function parseAmount(s, allowZero) {
    var t = String(s).replace(/[₦,\s]/g, '').toLowerCase();
    var m = /^(\d+\.?\d*|\.\d+)(k|m)?$/.exec(t);
    if (!m) return null;
    var n = parseFloat(m[1]);
    if (m[2] === 'k') n *= 1e3;
    if (m[2] === 'm') n *= 1e6;
    n = Math.round(n * 100) / 100;
    return (allowZero ? n >= 0 : n > 0) && n <= 1e9 ? n : null;
  }

  /* ---------- state ---------- */
  var data = { days: {}, settings: { list: [], last: {} } };
  var db = null;
  var ready = false;
  var method = null;
  var appliedPrefix = '';
  var confirmKey = null;
  var confirmTimer = null;
  var activeTab = 'sales';
  var revealed = false;
  var revealTimer = null;
  var fails = 0;
  var lockUntil = 0;
  var lastFocus = null;
  var repDate = null;
  var printingUntil = 0;

  var prefix = $('prefix'), suffix = $('suffix'), amount = $('amount'), methodInput = $('method');
  var recordBtn = $('record'), form = $('form');
  var openingInput = $('opening'), saveOpeningBtn = $('save-opening');
  var expDesc = $('exp-desc'), expAmount = $('exp-amount'), recordExpBtn = $('record-exp');
  var counted = $('counted');

  function cloneArr(a) { return Array.isArray(a) ? JSON.parse(JSON.stringify(a)) : []; }
  function normDay(date, v) {
    v = v || {};
    return { date: date, sales: cloneArr(v.sales), expenses: cloneArr(v.expenses), opening: typeof v.opening === 'number' ? v.opening : null };
  }
  function getDay(date, create) {
    var d = data.days[date];
    if (!d && create) { d = data.days[date] = normDay(date, {}); }
    return d;
  }
  function dayDoc(date) {
    var d = getDay(date, true);
    return { date: date, sales: d.sales, expenses: d.expenses, opening: d.opening };
  }
  function salesOf(date) { var d = data.days[date]; return d ? d.sales : []; }
  function expensesOf(date) { var d = data.days[date]; return d ? d.expenses : []; }

  function allSales() {
    var out = [];
    Object.keys(data.days).forEach(function (date) {
      data.days[date].sales.forEach(function (s) { out.push(Object.assign({ date: date }, s)); });
    });
    return out;
  }
  function allExpenses() {
    var out = [];
    Object.keys(data.days).forEach(function (date) {
      data.days[date].expenses.forEach(function (x) { out.push(Object.assign({ date: date }, x)); });
    });
    return out;
  }
  function dayTotals(date) {
    var d = data.days[date];
    var by = { POS: { c: 0, n: 0 }, Transfer: { c: 0, n: 0 }, Cash: { c: 0, n: 0 } };
    var all = { c: 0, n: 0 }, ex = { c: 0, n: 0 };
    if (d) {
      d.sales.forEach(function (s) {
        var b = by[s.method];
        if (!b) return;
        var c = Math.round(s.amount * 100);
        b.c += c; b.n++; all.c += c; all.n++;
      });
      d.expenses.forEach(function (x) { ex.c += Math.round(x.amount * 100); ex.n++; });
    }
    return { by: by, all: all, ex: ex, openC: d && d.opening != null ? Math.round(d.opening * 100) : null };
  }
  function counterCents(t) { return (t.openC || 0) + t.by.Cash.c - t.ex.c; }

  function lastSuffix(p) {
    var best = null;
    function consider(s) {
      s = String(s);
      if (!/^\d+$/.test(s)) return;
      if (best === null || Number(s) > Number(best)) best = s;
    }
    if (data.settings.last[p] != null) consider(data.settings.last[p]);
    allSales().forEach(function (s) { if (s.prefix === p) consider(s.suffix); });
    return best;
  }
  function nextSuffixes(p, count) {
    var last = p ? lastSuffix(p) : null;
    var used = {};
    allSales().forEach(function (s) { if (s.prefix === p) used[s.suffix] = true; });
    var n = last === null ? 1 : Number(last) + 1;
    var width = last !== null && last.charAt(0) === '0' ? last.length : 0;
    var out = [];
    while (out.length < count && n < 1e15) {
      var str = width ? String(n).padStart(width, '0') : String(n);
      if (!used[str]) out.push(str);
      n++;
    }
    return out;
  }

  /* ---------- hiding payments ---------- */
  function canSee(m) { return revealed || m === 'Cash'; }
  function money(m, n) { return canSee(m) ? fmt(n) : MASK; }

  function renderEye() {
    $('eye').setAttribute('aria-pressed', String(revealed));
    $('eye-label').textContent = revealed ? 'Hide payments' : 'Show payments';
    $('ico-show').hidden = revealed;
    $('ico-hide').hidden = !revealed;
    $('eye').title = revealed
      ? 'POS, Transfer and total amounts are showing. Click to hide them.'
      : 'POS, Transfer and total amounts are hidden until you enter the code';
  }
  function setRevealed(v) {
    revealed = v;
    clearTimeout(revealTimer);
    if (v) {
      revealTimer = setTimeout(function () { setRevealed(false); toast('Payments are hidden again.'); }, AUTO_HIDE_MS);
    }
    renderEye();
    renderAll();
  }
  function gateErr(msg) { $('gate-err').textContent = msg; }
  function openGate() {
    lastFocus = document.activeElement;
    $('code').value = '';
    gateErr('');
    $('gate').hidden = false;
    setTimeout(function () { $('code').focus(); }, 0);
  }
  function closeGate() {
    $('gate').hidden = true;
    $('code').value = '';
    var f = lastFocus && lastFocus.focus ? lastFocus : $('eye');
    f.focus();
  }
  function submitCode() {
    var now = Date.now();
    if (now < lockUntil) { gateErr('Too many tries. Wait ' + Math.ceil((lockUntil - now) / 1000) + ' seconds.'); return; }
    if ($('code').value.trim() === CODE) {
      fails = 0;
      closeGate();
      setRevealed(true);
    } else {
      fails++;
      $('code').value = '';
      if (fails >= 5) { lockUntil = now + 30000; fails = 0; gateErr('Too many tries. Wait 30 seconds.'); }
      else gateErr('That code is not right.');
      $('code').focus();
    }
  }
  $('eye').addEventListener('click', function () { if (revealed) setRevealed(false); else openGate(); });
  $('gate-ok').addEventListener('click', submitCode);
  $('gate-cancel').addEventListener('click', closeGate);
  $('gate').addEventListener('mousedown', function (e) { if (e.target === $('gate')) closeGate(); });
  $('gate').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target === $('code')) { e.preventDefault(); submitCode(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeGate(); }
    else if (e.key === 'Tab') {
      var f = [$('code'), $('gate-ok'), $('gate-cancel')];
      var i = f.indexOf(document.activeElement);
      var next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
      e.preventDefault();
      f[next].focus();
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && revealed && Date.now() > printingUntil) setRevealed(false);
  });

  /* ---------- tabs ---------- */
  function showTab(name) {
    if (TABS.indexOf(name) === -1) name = 'sales';
    activeTab = name;
    TABS.forEach(function (t) {
      $('view-' + t).hidden = t !== name;
      var b = $('tab-' + t);
      b.setAttribute('aria-selected', String(t === name));
      b.tabIndex = t === name ? 0 : -1;
    });
    try { localStorage.setItem(TAB_KEY, name); } catch (e) {}
    renderAll();
  }
  TABS.forEach(function (t, i) {
    var b = $('tab-' + t);
    b.addEventListener('click', function () { showTab(t); });
    b.addEventListener('keydown', function (e) {
      var j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
      else if (e.key === 'ArrowLeft') j = (i + TABS.length - 1) % TABS.length;
      if (j === null) return;
      e.preventDefault();
      showTab(TABS[j]);
      $('tab-' + TABS[j]).focus();
    });
  });

  /* ---------- storage ---------- */
  var queues = {};
  var pending = { settings: 0, days: 0 };
  function enqueue(key, fn) {
    var group = key === 'settings' ? 'settings' : 'days';
    pending[group]++;
    queues[key] = (queues[key] || Promise.resolve()).then(fn).then(function () {
      pending[group]--;
      if (db) setSync('db');
    }).catch(function (e) {
      pending[group]--;
      setSync('error');
      if (e && e.code === 'quota_exceeded') toast('Storage is full. Delete old entries or ask for help clearing space.', true);
      else toast('This entry is on screen but did not save. Check your connection and keep the page open.', true);
    });
  }
  function lsLoad() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var v = JSON.parse(raw);
      if (!(v && v.days && v.settings)) return;
      var days = {};
      Object.keys(v.days).forEach(function (k) {
        var x = v.days[k];
        days[k] = normDay(k, Array.isArray(x) ? { sales: x } : x);
      });
      data = { days: days, settings: { list: v.settings.list || [], last: v.settings.last || {} } };
    } catch (e) {}
  }
  function lsSave() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { setSync('error'); }
  }
  function saveDay(date) {
    if (db) return db.doc('days/' + date).set(dayDoc(date));
    lsSave();
    return Promise.resolve();
  }
  function saveSettings() {
    if (db) return db.doc('settings/main').set({ list: data.settings.list, last: data.settings.last });
    lsSave();
    return Promise.resolve();
  }
  function persistDay(date) { enqueue('day:' + date, function () { return saveDay(date); }); }

  var SYNC_TEXT = {
    connecting: ['Connecting…', ''],
    db: ['Saved online', 'Everything is stored with this page and is there when you reopen it.'],
    local: ['This device only', 'Entries are stored in this browser on this device only. Save a backup file from the Report page now and then.'],
    error: ['Not saved. Check connection', 'The last save did not go through. Keep this page open and try again.']
  };
  function setSync(state) {
    var s = $('sync');
    s.dataset.state = state;
    s.textContent = SYNC_TEXT[state][0];
    s.title = SYNC_TEXT[state][1];
  }
  var toastTimers = {};
  function toast(msg, isError, target) {
    target = target || (activeTab === 'expenses' ? 'exp' : activeTab === 'sales' ? 'sales' : 'sales');
    var t = $('toast-' + target);
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    clearTimeout(toastTimers[target]);
    toastTimers[target] = setTimeout(function () { t.textContent = ''; }, 4500);
  }

  /* ---------- combobox ---------- */
  function makeCombo(cfg) {
    var input = cfg.input, list = cfg.list;
    var items = [], active = -1, isOpen = false, browse = true;

    function setOpen(v) {
      isOpen = v;
      list.hidden = !v;
      input.setAttribute('aria-expanded', String(v));
      if (!v) input.removeAttribute('aria-activedescendant');
    }
    function render() {
      list.textContent = '';
      items.forEach(function (it, i) {
        var li = document.createElement('li');
        li.id = list.id + '-' + i;
        li.setAttribute('role', 'option');
        li.className = 'opt' + (i === active ? ' active' : '');
        li.setAttribute('aria-selected', String(i === active));
        if (it.dot) { var d = el('span', 'dot'); d.dataset.m = it.dot; li.appendChild(d); }
        li.appendChild(el('span', 'o-main', it.label));
        if (it.meta) li.appendChild(el('span', 'o-meta', it.meta));
        if (it.hot) li.appendChild(el('span', 'o-key', it.hot));
        if (it.remove) {
          var b = el('button', 'o-x', '×');
          b.type = 'button';
          b.tabIndex = -1;
          b.setAttribute('aria-label', 'Remove ' + it.label);
          b.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); it.remove(); });
          li.appendChild(b);
        }
        li.addEventListener('mousedown', function (e) { e.preventDefault(); pick(i); });
        list.appendChild(li);
      });
      if (active >= 0) {
        input.setAttribute('aria-activedescendant', list.id + '-' + active);
        var node = list.children[active];
        if (node) {
          var top = node.offsetTop, bottom = top + node.offsetHeight;
          if (top < list.scrollTop) list.scrollTop = top;
          else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
        }
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }
    function show(browseMode) {
      browse = browseMode;
      items = cfg.options(browse ? '' : input.value);
      if (browse) {
        active = -1;
        for (var i = 0; i < items.length; i++) {
          if (String(items[i].value) === input.value) { active = i; break; }
        }
      } else {
        active = items.length ? 0 : -1;
      }
      render();
      setOpen(items.length > 0);
    }
    function pick(i) {
      var it = items[i];
      if (!it) return;
      setOpen(false);
      cfg.onPick(it);
    }

    input.addEventListener('focus', function () { try { input.select(); } catch (e) {} show(true); });
    input.addEventListener('click', function () { if (!isOpen) show(true); });
    input.addEventListener('input', function () {
      if (cfg.sanitize) input.value = cfg.sanitize(input.value);
      show(false);
    });
    input.addEventListener('blur', function () {
      setOpen(false);
      if (cfg.onBlur) cfg.onBlur();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!isOpen) show(true);
        else if (items.length) { active = (active + 1) % items.length; render(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen) show(true);
        else if (items.length) { active = (active - 1 + items.length) % items.length; render(); }
      } else if (e.key === 'Enter') {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        if (isOpen && active >= 0) pick(active); else cfg.commit();
      } else if (e.key === 'Escape') {
        if (isOpen) { e.preventDefault(); setOpen(false); }
      } else if (cfg.onKey) {
        cfg.onKey(e, function (value) {
          for (var i = 0; i < items.length; i++) if (items[i].value === value) { pick(i); return; }
        });
      }
    });

    return {
      refresh: function () {
        if (!isOpen) return;
        items = cfg.options(browse ? '' : input.value);
        active = Math.min(active, items.length - 1);
        render();
        setOpen(items.length > 0);
      }
    };
  }

  /* ---------- amount dropdown (shared by sales, expenses and opening change) ---------- */
  function amtSanitize(v) { return v.replace(/[^\d.,kKmM₦\s]/g, ''); }
  function amountOptions(q, history, defaults, allowZero) {
    var counts = {};
    history.forEach(function (a) { counts[a] = (counts[a] || 0) + 1; });
    var freq = Object.keys(counts).map(function (k) { return { v: Number(k), c: counts[k] }; })
      .sort(function (a, b) { return b.c - a.c || b.v - a.v; });
    var res = [], seen = {};
    function add(v, meta) {
      if (v == null || seen[v]) return;
      seen[v] = true;
      res.push({ value: v, label: fmt(v), meta: meta || '' });
    }
    var digits = q.replace(/\D/g, '');
    if (!digits) {
      freq.slice(0, 6).forEach(function (f) { add(f.v, f.c + '× used'); });
      defaults.forEach(function (v) { add(v); });
      return res.slice(0, 8);
    }
    var n = parseAmount(q, allowZero);
    if (n !== null) add(n, 'as typed');
    freq.filter(function (f) { return String(f.v).replace('.', '').indexOf(digits) === 0; })
      .slice(0, 4).forEach(function (f) { add(f.v, f.c + '× used'); });
    if (n !== null && n > 0 && /^\d+$/.test(q.replace(/[,\s₦]/g, ''))) {
      [10, 100, 1000].forEach(function (m) { if (n * m <= 1e8) add(n * m); });
    }
    return res.slice(0, 8);
  }
  function makeAmountCombo(c) {
    return makeCombo({
      input: c.input, list: c.list, sanitize: amtSanitize,
      options: function (q) { return amountOptions(q, c.history(), c.defaults, c.allowZero); },
      onPick: function (it) { c.input.value = nf.format(it.value); c.next(); },
      commit: function () {
        var n = parseAmount(c.input.value, c.allowZero);
        if (n === null) { toast('Enter an amount like 2500 or 2.5k.', true, c.target); return; }
        c.input.value = nf.format(n);
        c.next();
      },
      onBlur: function () {
        var n = parseAmount(c.input.value, c.allowZero);
        if (n !== null) c.input.value = nf.format(n);
      }
    });
  }

  /* ---------- sales fields ---------- */
  function digitsOnly(v) { return v.replace(/\D/g, ''); }

  function afterPrefixChange() {
    var p = prefix.value;
    appliedPrefix = p;
    suffix.value = p ? (nextSuffixes(p, 1)[0] || '') : '';
    updatePreview();
  }
  function bumpPrefix(p) {
    var L = data.settings.list.filter(function (x) { return x !== p; });
    L.unshift(p);
    data.settings.list = L.slice(0, 30);
  }
  function removePrefix(p) {
    data.settings.list = data.settings.list.filter(function (x) { return x !== p; });
    delete data.settings.last[p];
    enqueue('settings', saveSettings);
    combos.prefix.refresh();
  }

  var combos = {};

  combos.prefix = makeCombo({
    input: prefix, list: $('prefix-list'), sanitize: digitsOnly,
    options: function (q) {
      var list = data.settings.list;
      var res = list.filter(function (p) { return p.indexOf(q) === 0; });
      var ix = res.indexOf(q);
      if (ix > 0) { res.splice(ix, 1); res.unshift(q); }
      var out = res.map(function (p) {
        var l = lastSuffix(p);
        return { value: p, label: p, meta: l ? 'last ' + l : '', remove: function () { removePrefix(p); } };
      });
      if (q && list.indexOf(q) === -1) out.unshift({ value: q, label: q, meta: 'save as new start', isNew: true });
      return out.slice(0, 10);
    },
    onPick: function (it) {
      prefix.value = it.value;
      if (it.isNew) { bumpPrefix(it.value); enqueue('settings', saveSettings); }
      afterPrefixChange();
      suffix.focus();
    },
    commit: function () {
      if (!prefix.value) { toast('Type the first digits of the ID, or pick one from the list.', true, 'sales'); return; }
      afterPrefixChange();
      suffix.focus();
    },
    onBlur: function () { if (prefix.value !== appliedPrefix) afterPrefixChange(); }
  });

  combos.suffix = makeCombo({
    input: suffix, list: $('suffix-list'), sanitize: digitsOnly,
    options: function (q) {
      var sug = nextSuffixes(prefix.value, 8);
      var res = [];
      if (q) res.push({ value: q, label: q, meta: 'as typed' });
      sug.forEach(function (s, i) {
        if (s !== q && s.indexOf(q) === 0) res.push({ value: s, label: s, meta: !q && i === 0 ? 'next' : '' });
      });
      return res.slice(0, 9);
    },
    onPick: function (it) { suffix.value = it.value; updatePreview(); amount.focus(); },
    commit: function () {
      if (!suffix.value) { toast('Type the last digits of the ID, or pick one from the list.', true, 'sales'); return; }
      amount.focus();
    }
  });

  combos.amount = makeAmountCombo({
    input: amount, list: $('amount-list'), target: 'sales', defaults: DEFAULT_AMOUNTS,
    history: function () {
      return allSales().filter(function (s) { return canSee(s.method); }).map(function (s) { return s.amount; });
    },
    next: function () { methodInput.focus(); }
  });

  function setMethod(key) {
    method = key;
    methodInput.value = key || '';
    if (key) methodInput.dataset.m = key; else delete methodInput.dataset.m;
  }
  combos.method = makeCombo({
    input: methodInput,
    list: $('method-list'),
    options: function () {
      return METHODS.map(function (m) {
        return { value: m.key, label: m.key, dot: m.key, hot: m.hot[0].toUpperCase() };
      });
    },
    onPick: function (it) { setMethod(it.value); recordBtn.focus(); },
    commit: function () {
      if (method) recordBtn.focus();
      else toast('Choose POS, Transfer or Cash.', true, 'sales');
    },
    onKey: function (e, pickValue) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key.toLowerCase();
      for (var i = 0; i < METHODS.length; i++) {
        if (METHODS[i].hot.indexOf(k) !== -1) { e.preventDefault(); pickValue(METHODS[i].key); return; }
      }
    }
  });

  /* ---------- expense and opening fields ---------- */
  function expHistory() {
    var counts = {}, label = {};
    allExpenses().forEach(function (x) {
      var k = x.desc.toLowerCase();
      counts[k] = (counts[k] || 0) + 1;
      if (!label[k]) label[k] = x.desc;
    });
    return Object.keys(counts).map(function (k) { return { text: label[k], c: counts[k] }; })
      .sort(function (a, b) { return b.c - a.c || a.text.localeCompare(b.text); });
  }
  combos.expDesc = makeCombo({
    input: expDesc, list: $('exp-desc-list'),
    options: function (q) {
      var qq = q.trim().toLowerCase();
      var res = [], seen = {};
      function add(text, meta) {
        var k = text.toLowerCase();
        if (seen[k]) return;
        seen[k] = true;
        res.push({ value: text, label: text, meta: meta || '' });
      }
      var hist = expHistory();
      if (!qq) {
        hist.slice(0, 6).forEach(function (h) { add(h.text, h.c + '× used'); });
        DEFAULT_EXPENSES.forEach(function (t) { add(t); });
        return res.slice(0, 8);
      }
      add(q.trim(), 'as typed');
      hist.filter(function (h) { return h.text.toLowerCase().indexOf(qq) !== -1; })
        .forEach(function (h) { add(h.text, h.c + '× used'); });
      DEFAULT_EXPENSES.filter(function (t) { return t.toLowerCase().indexOf(qq) !== -1; })
        .forEach(function (t) { add(t); });
      return res.slice(0, 8);
    },
    onPick: function (it) { expDesc.value = it.value; expAmount.focus(); },
    commit: function () {
      if (!expDesc.value.trim()) { toast('Say what the money was spent on.', true, 'exp'); return; }
      expAmount.focus();
    }
  });
  combos.expAmount = makeAmountCombo({
    input: expAmount, list: $('exp-amount-list'), target: 'exp', defaults: DEFAULT_AMOUNTS,
    history: function () { return allExpenses().map(function (x) { return x.amount; }); },
    next: function () { recordExpBtn.focus(); }
  });
  combos.opening = makeAmountCombo({
    input: openingInput, list: $('opening-list'), target: 'open', defaults: DEFAULT_OPENINGS, allowZero: true,
    history: function () {
      var out = [];
      Object.keys(data.days).forEach(function (k) { if (data.days[k].opening != null) out.push(data.days[k].opening); });
      return out;
    },
    next: function () { saveOpeningBtn.focus(); }
  });

  /* ---------- rendering ---------- */
  function updatePreview() {
    var p = prefix.value, s = suffix.value;
    var out = $('idprev');
    out.textContent = '';
    if (!p && !s) {
      out.appendChild(el('span', 'empty', 'Pick the first digits to begin'));
    } else {
      out.appendChild(el('span', 'p', p));
      out.appendChild(el('span', 's', s));
    }
    var dupe = $('dupe');
    var hit = null;
    if (p && s) {
      var full = p + s;
      allSales().forEach(function (x) { if (x.id === full) hit = x; });
    }
    if (hit) {
      var when = hit.date === dayKey(new Date()) ? 'today at ' + timeOf(hit.ts) : 'on ' + hit.date;
      dupe.textContent = 'This ID was already recorded ' + when + ': ' + money(hit.method, hit.amount) + ', ' + hit.method;
      dupe.hidden = false;
    } else {
      dupe.hidden = true;
    }
  }

  function label(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function renderTotals() {
    var t = dayTotals(dayKey(new Date()));
    METHODS.forEach(function (m) {
      var vis = canSee(m.key);
      $('sum-' + m.key).textContent = vis ? fmt(t.by[m.key].c / 100) : MASK;
      $('cnt-' + m.key).textContent = vis ? label(t.by[m.key].n, 'sale', 'sales') : 'hidden';
      $('tile-' + m.key).classList.toggle('masked', !vis);
    });
    $('sum-all').textContent = revealed ? fmt(t.all.c / 100) : MASK;
    $('cnt-all').textContent = revealed ? label(t.all.n, 'sale', 'sales') : 'hidden';
    $('tile-all').classList.toggle('masked', !revealed);
  }

  function renderTape() {
    var rows = salesOf(dayKey(new Date())).slice().sort(function (a, b) { return b.ts - a.ts; });
    $('tape-count').textContent = rows.length ? label(rows.length, 'sale', 'sales') : '';
    $('empty').hidden = rows.length > 0;
    $('table-wrap').hidden = rows.length === 0;
    var tbody = $('tbody');
    tbody.textContent = '';
    rows.forEach(function (s) {
      var tr = document.createElement('tr');
      var td1 = el('td', 'c-id');
      td1.appendChild(el('span', 'p', s.prefix));
      td1.appendChild(el('span', 's', s.suffix));
      td1.appendChild(el('span', 'time', timeOf(s.ts)));
      var td2 = document.createElement('td');
      var chip = el('span', 'chip');
      var dot = el('span', 'dot'); dot.dataset.m = s.method;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(s.method));
      td2.appendChild(chip);
      var td3 = el('td', 'c-amt' + (canSee(s.method) ? '' : ' masked'), money(s.method, s.amount));
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(deleteCell('sale', s.k, s.id));
      tbody.appendChild(tr);
    });
  }

  function deleteCell(kind, k, name) {
    var ck = kind + ':' + k;
    var td = el('td', 'c-del');
    var b = el('button', 'del' + (confirmKey === ck ? ' confirm' : ''), confirmKey === ck ? 'Delete?' : 'Delete');
    b.type = 'button';
    b.dataset.kind = kind;
    b.dataset.k = k;
    b.setAttribute('aria-label', (confirmKey === ck ? 'Confirm delete of ' : 'Delete ') + name);
    td.appendChild(b);
    return td;
  }
  function onDeleteClick(e) {
    var b = e.target.closest('.del');
    if (!b) return;
    var kind = b.dataset.kind, k = b.dataset.k, ck = kind + ':' + k;
    if (confirmKey === ck) {
      var date = dayKey(new Date());
      var d = data.days[date];
      if (d) {
        if (kind === 'sale') d.sales = d.sales.filter(function (s) { return s.k !== k; });
        else d.expenses = d.expenses.filter(function (x) { return x.k !== k; });
        persistDay(date);
      }
      confirmKey = null;
      renderAll();
      toast(kind === 'sale' ? 'Sale deleted.' : 'Expense deleted.', false, kind === 'sale' ? 'sales' : 'exp');
    } else {
      confirmKey = ck;
      renderTape();
      renderExpenseTape();
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(function () { confirmKey = null; renderTape(); renderExpenseTape(); }, 3500);
    }
  }
  $('tbody').addEventListener('click', onDeleteClick);
  $('exp-tbody').addEventListener('click', onDeleteClick);

  function renderExpenseTape() {
    var rows = expensesOf(dayKey(new Date())).slice().sort(function (a, b) { return b.ts - a.ts; });
    $('exp-count').textContent = rows.length ? label(rows.length, 'item', 'items') : '';
    $('exp-empty').hidden = rows.length > 0;
    $('exp-table-wrap').hidden = rows.length === 0;
    var tbody = $('exp-tbody');
    tbody.textContent = '';
    rows.forEach(function (x) {
      var tr = document.createElement('tr');
      var td1 = el('td', 'c-id c-desc');
      td1.appendChild(el('span', null, x.desc));
      td1.appendChild(el('span', 'time', timeOf(x.ts)));
      var td2 = el('td', 'c-amt', fmt(x.amount));
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(deleteCell('exp', x.k, x.desc));
      tbody.appendChild(tr);
    });
  }

  function yesterdayKey() { return dayKey(new Date(Date.now() - 864e5)); }

  function renderExpenses() {
    var t = dayTotals(dayKey(new Date()));
    $('sum-exp').textContent = fmt(t.ex.c / 100);
    $('cnt-exp').textContent = label(t.ex.n, 'item', 'items');
    $('sum-open').textContent = t.openC === null ? '—' : fmt(t.openC / 100);
    $('cnt-open').textContent = t.openC === null ? 'not set' : 'set for today';
    $('opening-state').textContent = t.openC === null
      ? 'Not set for today yet.'
      : 'Today\'s opening change is ' + fmt(t.openC / 100) + '. Save again to change it.';
    if (t.openC !== null && !openingInput.value && document.activeElement !== openingInput) {
      openingInput.value = nf.format(t.openC / 100);
    }
    var yd = data.days[yesterdayKey()];
    var useBtn = $('use-yesterday');
    if (t.openC === null && yd && yd.opening != null) {
      var yc = counterCents(dayTotals(yesterdayKey()));
      if (yc >= 0) {
        useBtn.textContent = 'Use yesterday\'s counter, ' + fmt(yc / 100);
        useBtn.dataset.value = String(yc / 100);
        useBtn.hidden = false;
      } else { useBtn.hidden = true; }
    } else {
      useBtn.hidden = true;
    }
    renderExpenseTape();
  }

  function renderCounter() {
    var t = dayTotals(dayKey(new Date()));
    var total = counterCents(t);
    $('c-open').textContent = fmt((t.openC || 0) / 100);
    $('c-open-note').textContent = t.openC === null ? 'not set' : '';
    $('c-cash').textContent = fmt(t.by.Cash.c / 100);
    $('c-cash-note').textContent = label(t.by.Cash.n, 'cash sale', 'cash sales');
    $('c-exp').textContent = fmt(t.ex.c / 100);
    $('c-exp-note').textContent = label(t.ex.n, 'expense', 'expenses');
    $('c-total').textContent = fmt(total / 100);
    $('c-result').classList.toggle('neg', total < 0);
    $('c-notice').hidden = t.openC !== null;
    renderDiff(total);
  }
  function renderDiff(total) {
    var d = $('c-diff');
    var n = parseAmount(counted.value, true);
    d.className = 'diff';
    if (n === null) { d.textContent = ''; return; }
    var diff = Math.round(n * 100) - total;
    if (diff === 0) { d.textContent = 'It matches. Nothing over or short.'; d.classList.add('ok'); }
    else if (diff > 0) { d.textContent = fmt(diff / 100) + ' over'; d.classList.add('off'); }
    else { d.textContent = fmt(-diff / 100) + ' short'; d.classList.add('off', 'short'); }
  }
  counted.addEventListener('input', function () {
    counted.value = amtSanitize(counted.value);
    renderDiff(counterCents(dayTotals(dayKey(new Date()))));
  });
  counted.addEventListener('blur', function () {
    var n = parseAmount(counted.value, true);
    if (n !== null) counted.value = nf.format(n);
  });
  counted.addEventListener('focus', function () { try { counted.select(); } catch (e) {} });

  /* ---------- daily report and printing ---------- */
  function repKey() { return repDate || dayKey(new Date()); }
  function keyToDate(k) { return new Date(k + 'T12:00:00'); }
  function shiftKey(k, n) { var d = keyToDate(k); d.setDate(d.getDate() + n); return dayKey(d); }
  function longDate(k) {
    return keyToDate(k).toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function noneRow(cols, text) {
    var tr = document.createElement('tr');
    var td = el('td', 'none', text);
    td.colSpan = cols;
    tr.appendChild(td);
    return tr;
  }

  function renderReport() {
    var key = repKey(), today = dayKey(new Date());
    var d = data.days[key];
    var t = dayTotals(key);
    var dateIn = $('rep-date');
    if (document.activeElement !== dateIn && dateIn.value !== key) dateIn.value = key;
    dateIn.max = today;
    $('rep-next').disabled = key >= today;
    $('rep-today').disabled = key === today;
    $('sheet-shop').textContent = $('shop-name').value.trim() || 'Sales ledger';
    $('sheet-date').textContent = 'Daily report · ' + longDate(key);
    $('sheet-printed').textContent = 'Generated ' + new Date().toLocaleString('en-NG', {
      day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    $('rep-hidden-note').hidden = revealed || !CAN_PRINT;

    var sum = $('rep-sum');
    sum.textContent = '';
    METHODS.forEach(function (m) {
      var vis = canSee(m.key);
      var tr = document.createElement('tr');
      tr.appendChild(el('td', null, m.key));
      tr.appendChild(el('td', 'c-amt', vis ? String(t.by[m.key].n) : '—'));
      tr.appendChild(el('td', 'c-amt' + (vis ? '' : ' masked'), vis ? fmt(t.by[m.key].c / 100) : MASK));
      sum.appendChild(tr);
    });
    $('rep-all-n').textContent = revealed ? String(t.all.n) : '—';
    $('rep-all').textContent = revealed ? fmt(t.all.c / 100) : MASK;

    var total = counterCents(t);
    $('rp-open').textContent = fmt((t.openC || 0) / 100);
    $('rp-open-note').textContent = t.openC === null ? 'not set' : '';
    $('rp-cash').textContent = fmt(t.by.Cash.c / 100);
    $('rp-cash-note').textContent = label(t.by.Cash.n, 'cash sale', 'cash sales');
    $('rp-exp').textContent = fmt(t.ex.c / 100);
    $('rp-exp-note').textContent = label(t.ex.n, 'expense', 'expenses');
    $('rp-total').textContent = fmt(total / 100);
    $('rp-result').classList.toggle('neg', total < 0);

    var sales = d ? d.sales.slice().sort(function (a, b) { return a.ts - b.ts; }) : [];
    var sb = $('rep-sales');
    sb.textContent = '';
    sales.forEach(function (s) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', 'c-time', timeOf(s.ts)));
      var idc = el('td', 'c-id');
      idc.appendChild(el('span', 'p', s.prefix));
      idc.appendChild(el('span', 's', s.suffix));
      tr.appendChild(idc);
      tr.appendChild(el('td', null, s.method));
      tr.appendChild(el('td', 'c-amt' + (canSee(s.method) ? '' : ' masked'), money(s.method, s.amount)));
      sb.appendChild(tr);
    });
    if (!sales.length) sb.appendChild(noneRow(4, 'No sales recorded.'));

    var exps = d ? d.expenses.slice().sort(function (a, b) { return a.ts - b.ts; }) : [];
    var eb = $('rep-exps');
    eb.textContent = '';
    exps.forEach(function (x) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', 'c-time', timeOf(x.ts)));
      tr.appendChild(el('td', 'c-desc', x.desc));
      tr.appendChild(el('td', 'c-amt', fmt(x.amount)));
      eb.appendChild(tr);
    });
    if (!exps.length) eb.appendChild(noneRow(3, 'No expenses recorded.'));
    $('rep-exp-total').textContent = fmt(t.ex.c / 100);
  }

  function printReport() {
    printingUntil = Date.now() + 20000;
    renderReport();
    window.print();
  }
  window.addEventListener('beforeprint', function () { printingUntil = Date.now() + 20000; renderReport(); });

  $('rep-date').addEventListener('change', function () {
    var v = $('rep-date').value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) repDate = v >= dayKey(new Date()) ? null : v;
    renderReport();
  });
  $('rep-prev').addEventListener('click', function () { repDate = shiftKey(repKey(), -1); renderReport(); });
  $('rep-next').addEventListener('click', function () {
    var n = shiftKey(repKey(), 1);
    repDate = n >= dayKey(new Date()) ? null : n;
    renderReport();
  });
  $('rep-today').addEventListener('click', function () { repDate = null; renderReport(); });
  $('rep-print').addEventListener('click', printReport);
  $('shop-name').addEventListener('input', function () {
    try { localStorage.setItem(SHOP_KEY, $('shop-name').value); } catch (e) {}
    renderReport();
  });

  /* ---------- backup (saved copy of the ledger only) ---------- */
  function validSale(s) {
    return s && typeof s.k === 'string' && typeof s.amount === 'number' && typeof s.ts === 'number' &&
      typeof s.id === 'string' && METHODS.some(function (m) { return m.key === s.method; });
  }
  function validExpense(x) {
    return x && typeof x.k === 'string' && typeof x.amount === 'number' && typeof x.ts === 'number' && typeof x.desc === 'string';
  }
  function exportBackup() {
    var blob = new Blob([JSON.stringify({ app: 'quick-sales-ledger', version: 1, savedAt: Date.now(), data: data })],
      { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sales-ledger-backup-' + dayKey(new Date()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    $('backup-msg').textContent = 'Backup file saved to your downloads.';
  }
  function importBackup(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var b = JSON.parse(String(r.result));
        var src = b && b.app === 'quick-sales-ledger' && b.data && b.data.days ? b.data : null;
        if (!src) throw new Error('That file is not a ledger backup.');
        var added = 0;
        Object.keys(src.days).forEach(function (date) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
          var from = normDay(date, src.days[date]), to = getDay(date, true), have = {};
          to.sales.forEach(function (s) { have[s.k] = true; });
          from.sales.forEach(function (s) { if (validSale(s) && !have[s.k]) { to.sales.push(s); have[s.k] = true; added++; } });
          var haveE = {};
          to.expenses.forEach(function (x) { haveE[x.k] = true; });
          from.expenses.forEach(function (x) { if (validExpense(x) && !haveE[x.k]) { to.expenses.push(x); haveE[x.k] = true; added++; } });
          if (to.opening == null && from.opening != null) to.opening = from.opening;
        });
        var st = src.settings || {};
        (Array.isArray(st.list) ? st.list : []).forEach(function (p) {
          if (/^\d+$/.test(p) && data.settings.list.indexOf(p) === -1) data.settings.list.push(p);
        });
        Object.keys(st.last || {}).forEach(function (p) {
          var cur = data.settings.last[p];
          if (/^\d+$/.test(String(st.last[p])) && (cur == null || Number(st.last[p]) > Number(cur))) data.settings.last[p] = String(st.last[p]);
        });
        lsSave();
        renderAll();
        $('backup-msg').textContent = added ? 'Restored. Added ' + added + (added === 1 ? ' entry.' : ' entries.') : 'Nothing new to add. Everything in that file is already here.';
      } catch (e) {
        $('backup-msg').textContent = (e && e.message) || 'Could not read that file.';
      }
    };
    r.readAsText(file);
  }
  $('backup-save').addEventListener('click', exportBackup);
  $('backup-restore').addEventListener('click', function () { $('backup-file').click(); });
  $('backup-file').addEventListener('change', function () {
    var f = $('backup-file').files && $('backup-file').files[0];
    if (f) importBackup(f);
    $('backup-file').value = '';
  });

  function renderAll() {
    renderTotals();
    renderTape();
    renderExpenses();
    renderCounter();
    renderReport();
    updatePreview();
    Object.keys(combos).forEach(function (k) { combos[k].refresh(); });
  }

  /* ---------- recording a sale ---------- */
  function fail(msg, field, target) { toast(msg, true, target); field.focus(); }

  function record() {
    if (!ready) { toast('Still connecting. Try again in a moment.', true, 'sales'); return; }
    var p = prefix.value.trim(), s = suffix.value.trim(), amt = parseAmount(amount.value);
    if (!p) return fail('Type or pick the first digits of the sales ID.', prefix, 'sales');
    if (!s) return fail('Pick or type the rest of the sales ID.', suffix, 'sales');
    if (amt === null) return fail('Enter an amount greater than zero.', amount, 'sales');
    if (!method) return fail('Choose POS, Transfer or Cash.', methodInput, 'sales');

    var now = Date.now();
    var date = dayKey(new Date(now));
    var sale = {
      k: now.toString(36) + Math.random().toString(36).slice(2, 6),
      id: p + s, prefix: p, suffix: s, amount: amt, method: method, ts: now
    };
    getDay(date, true).sales.push(sale);
    bumpPrefix(p);
    var prev = data.settings.last[p];
    if (prev == null || Number(s) >= Number(prev)) data.settings.last[p] = s;
    persistDay(date);
    enqueue('settings', saveSettings);

    amount.value = '';
    setMethod(null);
    appliedPrefix = p;
    suffix.value = nextSuffixes(p, 1)[0] || '';
    renderAll();
    toast('Recorded ' + sale.id + ' · ' + money(sale.method, amt) + ' · ' + sale.method, false, 'sales');
    amount.focus();
  }
  function safe(fn, target) {
    return function () {
      try { fn(); } catch (err) { toast('Could not save this: ' + (err && err.message ? err.message : 'unknown error'), true, target); }
    };
  }
  var safeRecord = safe(record, 'sales');
  recordBtn.addEventListener('click', safeRecord);
  form.addEventListener('submit', function (e) { e.preventDefault(); safeRecord(); });
  $('card-sales').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); safeRecord(); }
  });
  prefix.addEventListener('input', updatePreview);
  suffix.addEventListener('input', updatePreview);

  /* ---------- recording an expense and the opening change ---------- */
  function recordExpense() {
    if (!ready) { toast('Still connecting. Try again in a moment.', true, 'exp'); return; }
    var desc = expDesc.value.trim(), amt = parseAmount(expAmount.value);
    if (!desc) return fail('Say what the money was spent on.', expDesc, 'exp');
    if (amt === null) return fail('Enter an amount greater than zero.', expAmount, 'exp');
    desc = desc.charAt(0).toUpperCase() + desc.slice(1);
    var now = Date.now();
    var date = dayKey(new Date(now));
    getDay(date, true).expenses.push({
      k: now.toString(36) + Math.random().toString(36).slice(2, 6),
      desc: desc, amount: amt, ts: now
    });
    persistDay(date);
    expDesc.value = '';
    expAmount.value = '';
    renderAll();
    toast('Recorded ' + desc + ' · ' + fmt(amt), false, 'exp');
    expDesc.focus();
  }
  var safeExpense = safe(recordExpense, 'exp');
  recordExpBtn.addEventListener('click', safeExpense);
  $('card-exp').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); safeExpense(); }
  });

  function saveOpening() {
    if (!ready) { toast('Still connecting. Try again in a moment.', true, 'open'); return; }
    var n = parseAmount(openingInput.value, true);
    if (n === null) return fail('Enter the opening change, or 0 if there is none.', openingInput, 'open');
    var date = dayKey(new Date());
    getDay(date, true).opening = n;
    persistDay(date);
    openingInput.value = nf.format(n);
    renderAll();
    toast('Opening change saved: ' + fmt(n), false, 'open');
  }
  var safeOpening = safe(saveOpening, 'open');
  saveOpeningBtn.addEventListener('click', safeOpening);
  $('card-open').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); safeOpening(); }
  });
  $('use-yesterday').addEventListener('click', function () {
    var v = Number($('use-yesterday').dataset.value);
    openingInput.value = nf.format(v);
    openingInput.focus();
  });
  $('goto-open').addEventListener('click', function () {
    showTab('expenses');
    openingInput.focus();
  });

  /* ---------- start ---------- */
  function becomeReady() {
    if (ready) return;
    ready = true;
    recordBtn.disabled = false;
    recordExpBtn.disabled = false;
    saveOpeningBtn.disabled = false;
    if (!prefix.value && data.settings.list[0]) {
      prefix.value = data.settings.list[0];
      afterPrefixChange();
    }
    renderAll();
    if (activeTab === 'sales' && window.matchMedia && matchMedia('(pointer: fine)').matches && document.activeElement === document.body) amount.focus();
  }

  function subscribe() {
    var gotDays = false, gotSettings = false;
    function check() { if (gotDays && gotSettings) becomeReady(); }
    db.collection('days').orderBy('date', 'desc').limit(14).onSnapshot(function (snap) {
      if (!snap.metadata.fromCache) gotDays = true;
      if (pending.days === 0) {
        var days = {};
        snap.docs.forEach(function (d) { days[d.id] = normDay(d.id, d.data()); });
        data.days = days;
      }
      if (ready) renderAll(); else check();
    }, function () { setSync('error'); });
    db.doc('settings/main').onSnapshot(function (snap) {
      if (snap.exists && pending.settings === 0) {
        var v = JSON.parse(JSON.stringify(snap.data() || {}));
        data.settings = { list: Array.isArray(v.list) ? v.list : [], last: v.last && typeof v.last === 'object' ? v.last : {} };
      }
      if (!snap.metadata.fromCache) gotSettings = true;
      if (ready) renderAll(); else check();
    }, function () { setSync('error'); });
    setTimeout(becomeReady, 4000);
  }

  $('today').textContent = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  renderEye();
  $('rep-print').hidden = !CAN_PRINT;
  $('rep-preview-note').hidden = CAN_PRINT;
  try { $('shop-name').value = localStorage.getItem(SHOP_KEY) || ''; } catch (e) {}
  var savedTab = null;
  try { savedTab = localStorage.getItem(TAB_KEY); } catch (e) {}
  showTab(savedTab);

  (function init() {
    var p;
    try { p = (window.claude && window.claude.use) ? window.claude.use('db') : Promise.resolve(null); }
    catch (e) { p = Promise.resolve(null); }
    Promise.resolve(p).catch(function () { return null; }).then(function (handle) {
      if (handle) {
        db = handle;
        setSync('db');
        $('backup-card').hidden = true;
        subscribe();
      } else {
        lsLoad();
        setSync('local');
        $('backup-card').hidden = !CAN_PRINT;
        becomeReady();
      }
    });
  })();
})();
