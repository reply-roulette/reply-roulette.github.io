// リプ欄の読み取り結果（行ごと）から、名前と@IDを取り出す（ページとテストの両方で使う）
(function (root) {
  "use strict";
  const CJK = "\\u3000-\\u30ff\\u3400-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef";
  const SPACE_IN_CJK = new RegExp("([" + CJK + "])\\s+(?=[" + CJK + "])", "g");
  const isTimeRest = (r) => /^[・·\-–—.:]\s*\d/.test(r);
  const isTruncRest = (r) => /^(…|\.\.|--|-\+|—|–|-$|\.$)/.test(r);
  function cleanName(s) {
    s = String(s || "").replace(SPACE_IN_CJK, "$1").replace(/\s+/g, " ").trim();
    // 前後のごみ（読み取りで出やすい記号）を取る
    s = s.replace(/^[\s~〜()（）\[\]{}|_.,、。'"`*+\-=?!:;<>^]+/, "").replace(/[\s~〜()（）\[\]{}|_,、'"`*+\-=?:;<>^]+$/, "");
    return s.slice(0, 40);
  }
  // line: { text, words: [{ text, confidence }] }
  function parseLine(line) {
    const raw = String(line.text || "").replace(/[\r\n]+/g, " ");
    const t = raw.replace(/[④®©＠]/g, "@").trim();
    if (/^返信先/.test(t.replace(/\s/g, ""))) return null;
    let id = "", pre = "", rest = "";
    const m = t.match(/@\s?([A-Za-z0-9_]{2,15})/);
    if (m) { id = m[1]; pre = t.slice(0, m.index); rest = t.slice(m.index + m[0].length); }
    else {
      // 「@」が読めなかったとき：英数字のあとに「・時間」が続くものを@IDとみなす
      const m2 = t.match(/(^|\s)([A-Za-z0-9_]{3,15})(\s*[・·]\s*\d.*)$/);
      if (!m2) return null;
      id = m2[2]; pre = t.slice(0, m2.index + m2[1].length); rest = m2[3];
    }
    rest = rest.trim();
    const time = isTimeRest(rest), trunc = !time && isTruncRest(rest);
    if (!time && !trunc) return null;                       // 本文の中の@（名前の行ではない）
    // 名前：@IDより前の単語のうち、読み取りの自信があるものだけ
    let name = "", conf = 0, n = 0;
    const words = Array.isArray(line.words) ? line.words : [];
    if (words.length) {
      const parts = [];
      for (const w of words) {
        const wt = String(w.text || "").replace(/[④®©＠]/g, "@");
        if (wt.indexOf("@") >= 0 || wt.indexOf(id) >= 0) break;
        n++; conf += Number(w.confidence) || 0;
        // 記号だけの単語（絵文字の読みまちがいなど）は入れない
        if ((Number(w.confidence) || 0) >= 45 && /[0-9A-Za-z\u3040-\u30ff\u3400-\u9fff\uff10-\uff5a]/.test(wt)) parts.push(wt);
      }
      name = cleanName(parts.join(" "));
      if (name && /…\s*$/.test(pre) && !/…$/.test(name)) name += "…";
      name = name.replace(/\s+…$/, "…");
      conf = n ? conf / n : 0;
    } else { name = cleanName(pre); conf = 60; }
    if (!cleanName(pre)) return null;                       // 名前のない行（本文の先頭が@など）
    // IDが途中で切れているときも、確かめてもらう（発表の文に入るため）
    return { name, id, trunc, sure: conf >= 70 && !!name && !trunc };
  }
  // 行の一覧 → 参加者の一覧（同じ人は1人にまとめる・はぶくIDは入れない）
  function collect(lines, list, skip) {
    const skipSet = new Set((skip || []).map((s) => String(s).replace(/^@/, "").toLowerCase()).filter(Boolean));
    const out = list ? list.slice() : [];
    lines.forEach((l) => {
      const e = parseLine(l);
      if (!e || skipSet.has(e.id.toLowerCase())) return;
      out.push(e);
    });
    return dedupe(out);
  }
  const keyOf = (e) => (e.trunc ? "n:" + e.name : "i:" + e.id.toLowerCase());
  // 2つの文字のちがい（1文字ちがいなら、読みまちがいの同じ人とみなす）
  function dist(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    if (Math.abs(a.length - b.length) > 1) return 9;
    const d = []; for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const sameName = (x, y) => !x.name || !y.name || cleanName(x.name).replace(/…$/, "") === cleanName(y.name).replace(/…$/, "");
  function dedupe(list) {
    const map = new Map();
    list.forEach((e) => {
      const k = keyOf(e), old = map.get(k);
      if (!old) { map.set(k, e); return; }
      // 名前は、読み取りの自信がある方・長い方を残す
      if ((!old.sure && e.sure) || (!old.name && e.name)) old.name = e.name, old.sure = e.sure;
      if (e.manual) old.manual = true;
    });
    // 途中で切れた@IDは、最後まで読めた同じ人にまとめる
    const all = Array.from(map.values()), full = all.filter((e) => !e.trunc);
    const kept = all.filter((e) => !(e.trunc && full.some((f) => f.id.toLowerCase().indexOf(e.id.toLowerCase()) === 0)));
    // @IDが1文字だけちがい、名前も同じ（どちらかが読めていない）ものは、読みまちがいとして1人にまとめる（確かめてもらう印をつける）
    const res = [];
    kept.forEach((e) => {
      const hit = !e.manual && res.find((r) => !r.trunc && !e.trunc && r.id.length >= 4 && dist(r.id, e.id) === 1 && sameName(r, e));
      if (hit) { hit.sure = false; if (!hit.name && e.name) hit.name = e.name; hit.alt = (hit.alt || []).concat(e.id); }
      else res.push(e);
    });
    return res;
  }
  const api = { parseLine, collect, dedupe, cleanName, keyOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.RR_PARSE = api;
})(typeof window !== "undefined" ? window : globalThis);
