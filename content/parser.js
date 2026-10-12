(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ExtratorMapsParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function dig(obj, ...path) {
    let cur = obj;
    for (const idx of path) {
      if (!Array.isArray(cur) || idx < 0 || idx >= cur.length || cur[idx] == null) return null;
      cur = cur[idx];
    }
    return cur;
  }

  function placeKey(href) {
    const hrefStr = String(href || "");
    const fid = hrefStr.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
    if (fid) return fid[1].toLowerCase();
    try {
      const u = new URL(hrefStr, "https://www.google.com");
      const slug = u.pathname.match(/\/maps\/place\/([^/]+)/);
      if (slug) return decodeURIComponent(slug[1]).replace(/\+/g, " ").toLowerCase();
    } catch {
      /* href incompleto */
    }
    return hrefStr;
  }

  function cleanWebsite(raw) {
    if (!raw) return "";
    let url = String(raw).trim();
    if (url.startsWith("/url?") || /google\.[^/]+\/url\?/i.test(url)) {
      try {
        const u = new URL(url, "https://www.google.com");
        url = u.searchParams.get("q") || u.searchParams.get("url") || "";
      } catch {
        return "";
      }
    }
    if (!/^https?:\/\//i.test(url)) return "";
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return "";
    }
    const host = parsed.hostname.toLowerCase();
    const googleHost =
      /(^|\.)google\./.test(host) ||
      /(^|\.)gstatic\.com$/.test(host) ||
      /(^|\.)googleusercontent\.com$/.test(host) ||
      host === "goo.gl" ||
      host.endsWith(".goo.gl");
    if (googleHost && host !== "sites.google.com") return "";
    parsed.hash = "";
    return parsed.toString();
  }

  function cleanPhone(raw) {
    if (typeof raw !== "string") return "";
    const text = raw.replace(/\s+/g, " ").trim();
    const digits = text.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return "";
    if (text.length > 28) return "";
    return text;
  }

  function findPhone(node, depth) {
    if (node == null || depth > 6) return "";
    if (typeof node === "string") return cleanPhone(node);
    if (!Array.isArray(node)) return "";
    for (const child of node) {
      const found = findPhone(child, depth + 1);
      if (found) return found;
    }
    return "";
  }

  function openingHours(darray) {
    const items = dig(darray, 203, 0) || dig(darray, 34, 1) || [];
    if (!Array.isArray(items)) return [];
    const hours = [];
    for (const item of items) {
      const day = dig(item, 0);
      if (typeof day !== "string" || !day.trim()) continue;
      const times = [];
      const slots = dig(item, 3);
      if (Array.isArray(slots) && slots.length) {
        for (const slot of slots) {
          if (typeof slot === "string" && slot.trim()) times.push(slot.trim());
          else if (typeof dig(slot, 0) === "string") times.push(dig(slot, 0).trim());
        }
      } else if (Array.isArray(dig(item, 1))) {
        for (const slot of dig(item, 1)) {
          if (typeof slot === "string" && slot.trim()) times.push(slot.trim());
        }
      }
      hours.push({ day: day.trim(), hours: times.length ? times.join(", ") : "Fechado" });
    }
    return hours;
  }

  function formatHours(list) {
    if (!Array.isArray(list) || !list.length) return "";
    return list.map((item) => `${item.day}: ${item.hours}`).join(" | ");
  }

  function formatRating(score, count) {
    if (typeof score !== "number" || !Number.isFinite(score)) return "";
    const value = score.toFixed(1).replace(".", ",");
    if (typeof count === "number" && Number.isFinite(count)) return `${value} (${Math.round(count)})`;
    return value;
  }

  function scorePlace(node) {
    if (!Array.isArray(node) || node.length < 19) return 0;
    const title = dig(node, 11);
    if (typeof title !== "string") return 0;
    const name = title.trim();
    if (name.length < 2 || name.length > 180) return 0;
    let score = 1;
    const address = dig(node, 18);
    if (typeof address === "string" && address.trim().length > 8) score += 4;
    if (findPhone(dig(node, 178), 0)) score += 5;
    const web = dig(node, 7, 0);
    if (typeof web === "string" && cleanWebsite(web)) score += 3;
    const hours = dig(node, 203, 0) || dig(node, 34, 1);
    if (Array.isArray(hours) && hours.length) score += 2;
    const category = dig(node, 13, 0);
    if (typeof category === "string" && category.trim()) score += 1;
    return score;
  }

  function tryParseEmbedded(text) {
    if (typeof text !== "string" || text.length < 40) return null;
    let body = text.replace(/^\uFEFF/, "").trim();
    body = body.replace(/^\)\]\}'\s*/, "");
    const start = body.search(/[\[{]/);
    if (start < 0) return null;
    const slice = body.slice(start);
    try {
      return JSON.parse(slice);
    } catch {
      /* tenta o bloco balanceado */
    }
    const balanced = braceMatch(body, start);
    if (!balanced) return null;
    try {
      return JSON.parse(balanced);
    } catch {
      return null;
    }
  }

  function braceMatch(text, start) {
    const open = text[start];
    const close = open === "[" ? "]" : open === "{" ? "}" : "";
    if (!close) return "";
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return "";
  }

  function pickDarray(root) {
    if (Array.isArray(root) && scorePlace(root[6]) >= 5) return root[6];
    let best = null;
    let bestScore = 0;
    const stack = [root];
    let seen = 0;
    while (stack.length && seen < 250000) {
      const cur = stack.pop();
      seen += 1;
      if (typeof cur === "string") {
        const parsed = tryParseEmbedded(cur);
        if (parsed) stack.push(parsed);
        continue;
      }
      if (!Array.isArray(cur)) continue;
      const score = scorePlace(cur);
      if (score > bestScore) {
        bestScore = score;
        best = cur;
      }
      for (let i = cur.length - 1; i >= 0; i--) {
        const child = cur[i];
        if (Array.isArray(child) || (typeof child === "string" && child.length > 80)) stack.push(child);
      }
    }
    return bestScore >= 5 ? best : null;
  }

  function parseInitializationState(html) {
    const marker = "APP_INITIALIZATION_STATE=";
    const at = html.indexOf(marker);
    if (at < 0) return null;
    let i = at + marker.length;
    while (html[i] === " " || html[i] === "\n") i += 1;
    if (html[i] !== "[" && html[i] !== "{") return null;
    const blob = braceMatch(html, i);
    if (!blob) return null;
    try {
      return JSON.parse(blob);
    } catch {
      return null;
    }
  }

  function extractPreviewUrl(html, origin) {
    const decoded = String(html || "")
      .replace(/\\u0026/gi, "&")
      .replace(/\\u003d/gi, "=")
      .replace(/\\x26/gi, "&")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");
    const match = decoded.match(/\/maps\/preview\/place\?[^"'\\\s<>]+/);
    if (!match) return "";
    try {
      return new URL(match[0], origin || "https://www.google.com").toString();
    } catch {
      return "";
    }
  }

  function readPlace(darray) {
    if (!darray) return null;
    const nome = typeof dig(darray, 11) === "string" ? dig(darray, 11).trim() : "";
    const endereco = typeof dig(darray, 18) === "string" ? dig(darray, 18).trim() : "";
    const telefone = findPhone(dig(darray, 178), 0);
    const site = cleanWebsite(dig(darray, 7, 0));
    const horario = formatHours(openingHours(darray));
    const categoria = typeof dig(darray, 13, 0) === "string" ? dig(darray, 13, 0).trim() : "";
    const avaliacao = formatRating(dig(darray, 4, 7), dig(darray, 4, 8));
    if (!nome && !endereco && !telefone && !site) return null;
    return { nome, endereco, telefone, site, horario, categoria, avaliacao };
  }

  function fallbackContacts(text) {
  const raw = String(text || "");
  let telefone = "";
  const phoneRe = /"(\+\d{1,3}[\s\d().-]{8,18}|\(\d{2}\)\s*\d{4,5}-\d{4})"/g;
  let match;
  while ((match = phoneRe.exec(raw))) {
    telefone = cleanPhone(match[1]);
    if (telefone) break;
  }

  let site = "";
  const webRe = /\/url\?q=([^&"\\]+)/g;
  while ((match = webRe.exec(raw))) {
    let value = match[1];
    try {
      value = decodeURIComponent(value);
    } catch {
      /* mantém o texto original */
    }
    site = cleanWebsite(value.startsWith("http") ? value : `/url?q=${match[1]}`);
    if (site) break;
  }
  return { telefone, site };
}

function parsePlaceDocument(text, origin) {
    const raw = String(text || "");
    if (/consent\.google\.com|Antes de continuar/i.test(raw) && !/APP_INITIALIZATION_STATE|\/maps\/preview\/place/.test(raw)) {
      return { consent: true };
    }
    const direct = tryParseEmbedded(raw);
    const fromState = raw.includes("APP_INITIALIZATION_STATE=") ? parseInitializationState(raw) : null;
    const darray = pickDarray(direct) || pickDarray(fromState) || (fromState ? pickDarray([fromState]) : null);
    const place = readPlace(darray);
    const extra = /<html[\s>]/i.test(raw) ? { telefone: "", site: "" } : fallbackContacts(raw);
    if (place) {
      if (!place.telefone && extra.telefone) place.telefone = extra.telefone;
      if (!place.site && extra.site) place.site = extra.site;
    }
    const previewUrl = extractPreviewUrl(raw, origin);
    return { consent: false, place, previewUrl };
  }

  function isHourText(value) {
    return /aberto|fechado|abre|fecha|24\s*horas|open now|closed|opens|closes|hor[aá]rio|permanently|temporar/i.test(value);
  }

  function isAddressText(value) {
    return (
      /^(r\.|rua\b|av\.|avenida\b|trav(?:essa|\.)\b|rod\.|rodovia\b|alameda\b|pra[cç]a\b|pc\.|estr(?:ada|\.)\b|tv\.|largo\b|beco\b|via\b|conjunto\b|cj\.|quadra\b|qd\.|lote\b|lt\.|rua |avenida )/i.test(
        value
      ) ||
      /\d{5}-?\d{3}/.test(value) ||
      /\b(rua|avenida|rodovia|travessa|alameda)\b/i.test(value)
    );
  }

  function parseCardText(name, text) {
    const lines = String(text || "")
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    let endereco = "";
    let categoria = "";
    let rating = "";
    let reviews = "";
    const hourParts = [];

    function consume(part) {
      if (!part || part === name) return;
      if (/^patrocinado$/i.test(part)) return;
      if (/^["“]/.test(part)) return;
      if (/^[★☆\s]+$/.test(part)) return;

      const starLine = part.match(/(\d[,.]\d)\s*estrelas?/i);
      if (starLine) {
        rating = starLine[1];
        const count = part.match(/([\d.]+)\s*avalia/i);
        if (count) reviews = `(${count[1].replace(/\./g, "")})`;
        return;
      }

      if (/^\d[,.]\d$/.test(part)) {
        rating = part;
        return;
      }
      if (/^\(\d[\d.]*\)$/.test(part)) {
        reviews = part.includes(".") ? `(${part.replace(/[().]/g, "")})` : part;
        return;
      }
      const combined = part.match(/^(\d[,.]\d)\s*(\(\d[\d.]*\))$/);
      if (combined) {
        rating = combined[1];
        reviews = combined[2];
        return;
      }
      if (isHourText(part)) {
        hourParts.push(part);
        return;
      }
      if (isAddressText(part)) {
        if (!endereco || part.length > endereco.length) endereco = part;
        return;
      }
      if (!categoria && part.length <= 48 && !/\d{3,}/.test(part)) categoria = part;
    }

    for (const line of lines) {
      if (line === name) continue;
      const parts = line.split(/\s*[·•|]\s*/).map((part) => part.trim()).filter(Boolean);
      if (parts.length > 1) parts.forEach(consume);
      else consume(line);
    }

    return {
      endereco,
      horario: hourParts.join(" · "),
      categoria,
      avaliacao: [rating, reviews].filter(Boolean).join(" "),
    };
  }

  function csvCell(value) {
    const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
    if (/[;"\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function toCsv(rows) {
    const header = ["nome", "link", "endereco", "horario", "telefone", "site", "avaliacao", "categoria"];
    const lines = [header.join(";")];
    for (const row of rows) {
      lines.push(header.map((key) => csvCell(row[key])).join(";"));
    }
    return `\uFEFF${lines.join("\r\n")}`;
  }

  return {
    dig,
    placeKey,
    cleanWebsite,
    cleanPhone,
    parseCardText,
    parsePlaceDocument,
    fallbackContacts,
    extractPreviewUrl,
    toCsv,
    formatHours,
  };
});
