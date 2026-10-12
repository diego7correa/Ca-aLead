(() => {
  if (globalThis.__EXTRATOR_MAPS__) return;
  globalThis.__EXTRATOR_MAPS__ = true;

  const Parser = globalThis.ExtratorMapsParser;
  const HOST_ID = "extrator-maps-host";
  const MAX_PLACES = 500;

  const state = {
    places: [],
    query: "",
    running: false,
    runLimit: null,
    stopRequested: false,
    phase: "idle",
    current: 0,
    total: 0,
    activeKey: "",
    status: "",
  };

  let host = null;
  let shadow = null;
  let ui = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function originOf(href) {
    try {
      return new URL(href, location.href).origin;
    } catch {
      return location.origin;
    }
  }

  function safeMapsUrl(href) {
    try {
      const url = new URL(href, location.href);
      if (url.protocol !== "https:") return "";
      if (!/(^|\.)google\./i.test(url.hostname)) return "";
      if (!url.pathname.includes("/maps/place")) return "";
      return url.toString();
    } catch {
      return "";
    }
  }

  function sameOriginMapsUrl(href) {
    const safe = safeMapsUrl(href);
    if (!safe) return "";
    const url = new URL(safe);
    url.protocol = location.protocol;
    url.hostname = location.hostname;
    return url.toString();
  }

  function blankPlace(partial) {
    return {
      key: partial.key,
      nome: partial.nome || "",
      link: partial.link || "",
      endereco: partial.endereco || "",
      horario: partial.horario || "",
      telefone: partial.telefone || "",
      site: partial.site || "",
      avaliacao: partial.avaliacao || "",
      categoria: partial.categoria || "",
      detalhe: false,
      erro: "",
    };
  }

  function findCard(anchor, feed) {
    let el = anchor;
    while (el.parentElement && el.parentElement !== feed) {
      const parent = el.parentElement;
      const keys = new Set(
        [...parent.querySelectorAll('a[href*="/maps/place/"]')].map((item) => Parser.placeKey(item.href))
      );
      if (keys.size > 1) break;
      el = parent;
    }
    return el;
  }

  function readName(anchor, card) {
    const heading = card.querySelector(".fontHeadlineSmall, .qBF1Pd");
    const fromHeading = heading?.textContent?.replace(/\s+/g, " ").trim();
    if (fromHeading) return fromHeading;
    const label = anchor.getAttribute("aria-label")?.replace(/\s+/g, " ").trim();
    return label || "";
  }

  function collectFromFeed(feed) {
    const anchors = [...feed.querySelectorAll('a[href*="/maps/place/"]')];
    const places = [];
    const indexByKey = new Map();

    for (const anchor of anchors) {
      const link = safeMapsUrl(anchor.href);
      if (!link) continue;
      const key = Parser.placeKey(link);
      const card = findCard(anchor, feed);
      const nome = readName(anchor, card);
      if (!nome) continue;
      const parsed = Parser.parseCardText(nome, card.innerText || "");
      const place = blankPlace({
        key,
        nome,
        link,
        endereco: parsed.endereco,
        horario: parsed.horario,
        avaliacao: parsed.avaliacao,
        categoria: parsed.categoria,
      });
      const existing = indexByKey.get(key);
      if (existing == null) {
        indexByKey.set(key, places.length);
        places.push(place);
        continue;
      }
      const previous = places[existing];
      if ((card.innerText || "").length > (previous.nome + previous.endereco + previous.horario).length) {
        place.telefone = previous.telefone;
        place.site = previous.site;
        place.detalhe = previous.detalhe;
        place.erro = previous.erro;
        if (previous.detalhe && previous.endereco) place.endereco = previous.endereco;
        if (previous.detalhe && previous.horario) place.horario = previous.horario;
        if (previous.detalhe && previous.avaliacao) place.avaliacao = previous.avaliacao;
        if (previous.detalhe && previous.categoria) place.categoria = previous.categoria;
        places[existing] = place;
      }
    }
    return places;
  }

  function collectSinglePlace() {
    const link = safeMapsUrl(location.href);
    if (!link) return [];
    const nome = document.querySelector("h1.DUwDvf, h1")?.textContent?.replace(/\s+/g, " ").trim() || "";
    if (!nome || nome.length > 180) return [];
    return [blankPlace({ key: Parser.placeKey(link), nome, link })];
  }

  function scanPage() {
    const feed = document.querySelector('div[role="feed"]');
    if (feed) return { feed, places: collectFromFeed(feed) };
    return { feed: null, places: collectSinglePlace() };
  }

  function rememberQuery() {
    const query = currentQuery();
    if (state.query && query && query !== state.query) state.places = [];
    if (query) state.query = query;
  }

  function accumulate(found) {
    const map = new Map(state.places.map((place) => [place.key, place]));
    const order = state.places.map((place) => place.key);
    for (const place of found) {
      const old = map.get(place.key);
      if (!old) {
        order.push(place.key);
        map.set(place.key, place);
        continue;
      }
      if (!old.link && place.link) old.link = place.link;
      if (!old.detalhe) {
        if (place.endereco && place.endereco.length > (old.endereco || "").length) old.endereco = place.endereco;
        if (place.horario && place.horario.length > (old.horario || "").length) old.horario = place.horario;
        if (!old.avaliacao && place.avaliacao) old.avaliacao = place.avaliacao;
        if (!old.categoria && place.categoria) old.categoria = place.categoria;
      }
    }
    state.places = order.map((key) => map.get(key)).filter(Boolean).slice(0, MAX_PLACES);
  }

  function currentQuery() {
    return document.querySelector("#searchboxinput")?.value?.trim() || "";
  }

  function reachedEnd(feed) {
    const text = feed?.innerText || "";
    return /chegou ao final da lista|reached the end of the list|fin de la liste|llegaste al final|has llegado al final/i.test(text);
  }

  function scrollTarget(feed) {
    let el = feed;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 40) return el;
      el = el.parentElement;
    }
    return feed;
  }

  async function scrollFeed(feed) {
    const scroller = scrollTarget(feed);
    let stable = 0;
    let lastCount = state.places.length;

    for (let step = 0; step < 120 && !state.stopRequested; step += 1) {
      if (state.runLimit && state.places.length >= state.runLimit) break;
      if (currentQuery() && state.query && currentQuery() !== state.query) {
        state.stopRequested = true;
        setStatus("A busca mudou. Extração interrompida para não misturar listas.");
        break;
      }
      const ended = reachedEnd(feed);
      const stepPx = Math.max(480, Math.round(scroller.clientHeight * 0.85));
      const nextTop = Math.min(scroller.scrollTop + stepPx, scroller.scrollHeight);
      scroller.scrollTop = nextTop;
      const anchors = feed.querySelectorAll('a[href*="/maps/place/"]');
      anchors[anchors.length - 1]?.scrollIntoView({ block: "end" });
      await sleep(800 + Math.round(Math.random() * 400));
      if (state.stopRequested) break;

      accumulate(collectFromFeed(feed));
      trimToRunLimit();
      render();
      if (state.runLimit && state.places.length >= state.runLimit) {
        setStatus(`Limite de ${state.runLimit} estabelecimentos atingido.`);
        break;
      }
      setStatus(`Percorrendo a lista… ${state.places.length} estabelecimentos`);

      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 12;
      if (state.places.length === lastCount && (atBottom || ended)) stable += 1;
      else if (state.places.length !== lastCount) stable = 0;
      lastCount = state.places.length;

      if (state.places.length >= MAX_PLACES) {
        setStatus(`Limite de ${MAX_PLACES} estabelecimentos nesta extração.`);
        break;
      }
      if (ended && stable >= 1) break;
      if (atBottom && stable >= 4) break;
    }
  }

  async function fetchText(url) {
    const response = await fetch(url, { credentials: "include", redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  function fetchTextInBackground(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "FETCH_TEXT", url }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!res?.ok) {
          reject(new Error(res?.error || `HTTP ${res?.status || ""}`.trim()));
          return;
        }
        resolve(res.text || "");
      });
    });
  }

  async function readText(url) {
    try {
      const text = await fetchText(url);
      if (text && text.length > 1000) return text;
    } catch {
      /* tenta pelo service worker */
    }
    return fetchTextInBackground(url);
  }

  function applyDetails(place, details) {
    if (!details) return;
    if (details.endereco) place.endereco = details.endereco;
    if (details.horario) place.horario = details.horario;
    if (details.telefone) place.telefone = details.telefone;
    if (details.site) place.site = details.site;
    if (details.avaliacao) place.avaliacao = details.avaliacao;
    if (details.categoria) place.categoria = details.categoria;
    if (details.nome && !place.nome) place.nome = details.nome;
  }

  async function enrichPlace(place) {
    const pageUrl = sameOriginMapsUrl(place.link);
    if (!pageUrl) {
      place.detalhe = true;
      place.erro = "Link do estabelecimento inválido.";
      return;
    }
    const html = await readText(pageUrl);
    let parsed = Parser.parsePlaceDocument(html, originOf(pageUrl));
    if (parsed?.consent) {
      place.erro = "O Google pediu consentimento de cookies nesta conta.";
      place.detalhe = true;
      return;
    }
    if (parsed?.place) applyDetails(place, parsed.place);

    const needsMore = !place.telefone || !place.site || !place.endereco;
    if (needsMore && parsed?.previewUrl) {
      const preview = await readText(parsed.previewUrl);
      const fromPreview = Parser.parsePlaceDocument(preview, originOf(parsed.previewUrl));
      if (fromPreview?.consent) {
        place.erro = "O Google pediu consentimento de cookies nesta conta.";
      } else if (fromPreview?.place) {
        applyDetails(place, fromPreview.place);
        place.erro = "";
      }
    }

    place.detalhe = true;
    if (!place.telefone && !place.site && !place.erro) {
      place.erro = "Ficha lida, sem telefone nem site publicados.";
    }
  }

  function readLimit() {
    const raw = String(ui.limit.value || "").trim();
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 1) return null;
    return Math.min(Math.floor(value), MAX_PLACES);
  }

  function trimToRunLimit() {
    if (!state.runLimit || state.places.length <= state.runLimit) return;
    state.places = state.places.slice(0, state.runLimit);
  }

  function delayRange() {
    let min = Number(ui.delayMin.value);
    let max = Number(ui.delayMax.value);
    if (!Number.isFinite(min) || min < 0) min = 1;
    if (!Number.isFinite(max) || max < min) max = min;
    if (max > 30) max = 30;
    return { min, max };
  }

  async function run() {
    if (state.running) return;
    state.running = true;
    state.stopRequested = false;
    state.runLimit = readLimit();
    state.phase = "scroll";
    render();

    try {
      rememberQuery();
      const scanned = scanPage();
      accumulate(scanned.places);
      trimToRunLimit();
      render();

      if (!state.places.length) {
        setStatus("Nenhuma lista encontrada. Faça uma busca no Google Maps e atualize.");
        return;
      }

      const alreadyAtLimit = state.runLimit && state.places.length >= state.runLimit;
      if (scanned.feed && !state.stopRequested && !alreadyAtLimit) await scrollFeed(scanned.feed);
      if (state.stopRequested) {
        setStatus(`Interrompido na lista. ${state.places.length} estabelecimentos mapeados.`);
        return;
      }

      state.phase = "details";
      const pending = state.places.filter((place) => !place.detalhe);
      state.total = pending.length;
      state.current = 0;
      const range = delayRange();

      for (const place of pending) {
        if (state.stopRequested) break;
        state.current += 1;
        state.activeKey = place.key;
        place.erro = "";
        setStatus(`Lendo ficha ${state.current} de ${state.total}: ${place.nome}`);
        render();
        try {
          await enrichPlace(place);
        } catch (error) {
          place.detalhe = true;
          place.erro = "Não foi possível ler esta ficha.";
          console.warn("[Extrator Maps]", place.nome, error);
        }
        render();
        if (state.current < state.total && !state.stopRequested) {
          const wait = (range.min + Math.random() * (range.max - range.min)) * 1000;
          await sleep(Math.max(80, wait));
        }
      }

      const phones = state.places.filter((place) => place.telefone).length;
      const sites = state.places.filter((place) => place.site).length;
      if (state.stopRequested) {
        setStatus(`Interrompido. ${phones} telefones e ${sites} sites coletados.`);
      } else {
        setStatus(`Concluído. ${state.places.length} estabelecimentos, ${phones} telefones, ${sites} sites.`);
      }
    } finally {
      state.running = false;
      state.phase = "idle";
      state.runLimit = null;
      state.activeKey = "";
      render();
      publishBadge();
    }
  }

  function publishBadge() {
    const text = state.places.length ? String(Math.min(state.places.length, 999)) : "";
    chrome.runtime.sendMessage({ type: "BADGE", text });
  }

  function setStatus(text) {
    state.status = text;
    if (ui?.status) ui.status.textContent = text;
  }

  function counts() {
    return {
      total: state.places.length,
      phones: state.places.filter((place) => place.telefone).length,
      sites: state.places.filter((place) => place.site).length,
    };
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function ensurePanel() {
    host = document.getElementById(HOST_ID);
    if (host?.shadowRoot && ui) return;

    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = "position:fixed;inset:0;width:0;height:0;z-index:2147483646;pointer-events:none;";
    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = chrome.runtime.getURL("content/panel.css");
    shadow.appendChild(style);

    const panel = el("section", "panel");
    panel.style.top = "72px";
    panel.style.left = `${Math.max(16, Math.min(window.innerWidth - 940, 430))}px`;
    panel.addEventListener("pointerdown", (event) => event.stopPropagation());
    panel.addEventListener("wheel", (event) => event.stopPropagation());
    panel.addEventListener("keydown", (event) => event.stopPropagation());
    panel.addEventListener("keyup", (event) => event.stopPropagation());

    const header = el("header", "header");
    header.appendChild(logo());
    const titles = el("div", "titles");
    const heading = el("h1", "", "Extrator Maps");
    const subtitle = el("p");
    titles.append(heading, subtitle);
    const close = el("button", "close", "×");
    close.type = "button";
    close.title = "Fechar";
    close.addEventListener("click", () => {
      state.stopRequested = true;
      host.style.display = "none";
    });
    header.append(titles, close);

    let drag = null;
    header.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      header.setPointerCapture(event.pointerId);
    });
    header.addEventListener("pointermove", (event) => {
      if (!drag) return;
      panel.style.left = `${Math.max(8, event.clientX - drag.x)}px`;
      panel.style.top = `${Math.max(8, event.clientY - drag.y)}px`;
    });
    header.addEventListener("pointerup", () => {
      drag = null;
    });

    const toolbar = el("div", "toolbar");
    const refresh = button("Atualizar lista", () => refreshList());
    const start = button("Iniciar extração", () => run(), "btn primary");
    const stop = button("Parar", () => {
      state.stopRequested = true;
      setStatus("Parando…");
    }, "btn stop");
    const csv = button("CSV", () => downloadCsv());
    const copy = button("Copiar", () => copyTable());
    const options = el("div", "options");
    const limitField = el("label", "field");
    limitField.append("Limite ", limitInput());
    const delay = el("label", "field");
    delay.append("Atraso ", delayInput("delayMin", "1"), " a ", delayInput("delayMax", "2"), " s");
    options.append(limitField, delay);
    toolbar.append(refresh, start, stop, csv, copy, options);

    const meta = el("div", "meta");
    const stats = el("div", "stats");
    const status = el("div", "status", "Abra uma busca e mapeie a lista.");
    meta.append(stats, status);
    const progress = el("div", "progress");
    progress.appendChild(el("div"));
    const tableWrap = el("div", "table-wrap");
    const footer = el(
      "div",
      "footer",
      "O telefone e o site são lidos em segundo plano, sem abrir cada estabelecimento. Mantenha esta aba aberta."
    );

    panel.append(header, toolbar, meta, progress, tableWrap, footer);
    shadow.appendChild(panel);
    document.documentElement.appendChild(host);

    ui = {
      panel,
      subtitle,
      refresh,
      start,
      stop,
      csv,
      copy,
      delayMin: delay.querySelector('[data-field="delayMin"]'),
      delayMax: delay.querySelector('[data-field="delayMax"]'),
      limit: limitField.querySelector('[data-field="limit"]'),
      stats,
      status,
      progress,
      tableWrap,
    };
    chrome.storage.local.get({ delayMin: "1", delayMax: "2", limit: "" }, (saved) => {
      ui.delayMin.value = saved.delayMin;
      ui.delayMax.value = saved.delayMax;
      ui.limit.value = saved.limit || "";
    });
    ui.delayMin.addEventListener("change", persistSettings);
    ui.delayMax.addEventListener("change", persistSettings);
    ui.limit.addEventListener("change", persistSettings);
  }

  function persistSettings() {
    chrome.storage.local.set({
      delayMin: ui.delayMin.value,
      delayMax: ui.delayMax.value,
      limit: ui.limit.value.trim(),
    });
  }

  function button(label, onClick, className) {
    const node = el("button", className || "btn", label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  function limitInput() {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.step = "1";
    input.placeholder = "todos";
    input.dataset.field = "limit";
    input.title = "Opcional. Deixe vazio para extrair a lista inteira.";
    return input;
  }

  function delayInput(field, value) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "30";
    input.step = "0.5";
    input.value = value;
    input.dataset.field = field;
    return input;
  }

  function logo() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 32 32");
    svg.setAttribute("class", "logo");
    svg.innerHTML =
      '<circle cx="16" cy="13" r="6" fill="#ffffff"/><circle cx="16" cy="13" r="2.4" fill="#0f766e"/><path d="M16 19.2 12.8 28h6.4z" fill="#ffffff"/>';
    return svg;
  }

  function refreshList() {
    rememberQuery();
    const scanned = scanPage();
    accumulate(scanned.places);
    const query = currentQuery();
    if (!state.places.length) {
      setStatus(query ? `Nenhum estabelecimento visível para “${query}”. Role a lista ou inicie a extração.` : "Faça uma busca no Google Maps para listar os estabelecimentos.");
    } else {
      setStatus(`${state.places.length} estabelecimentos mapeados na lista atual.`);
    }
    render();
    publishBadge();
  }

  function render() {
    if (!ui || host.style.display === "none") return;
    const query = currentQuery();
    ui.subtitle.textContent = query ? `Busca: ${query}` : "Lista de estabelecimentos do Google Maps";
    const { total, phones, sites } = counts();
    ui.stats.replaceChildren(
      chip("Na lista", total),
      chip("Telefones", phones),
      chip("Sites", sites)
    );
    ui.start.disabled = state.running;
    ui.refresh.disabled = state.running;
    ui.stop.disabled = !state.running;
    ui.csv.disabled = !state.places.length;
    ui.copy.disabled = !state.places.length;

    if (state.phase === "scroll") {
      ui.progress.classList.add("indeterminate");
      ui.progress.firstElementChild.style.width = "";
    } else if (state.phase === "details" && state.total) {
      ui.progress.classList.remove("indeterminate");
      ui.progress.firstElementChild.style.width = `${Math.round((state.current / state.total) * 100)}%`;
    } else {
      ui.progress.classList.remove("indeterminate");
      ui.progress.firstElementChild.style.width = state.places.length ? "100%" : "0";
    }

    const scrollTop = ui.tableWrap.scrollTop;
    if (!state.places.length) {
      ui.tableWrap.replaceChildren(
        el(
          "div",
          "empty",
          "Nenhuma lista mapeada. Busque um tipo de estabelecimento no Google Maps, como “barbearia”, e clique em Atualizar lista."
        )
      );
      return;
    }

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const label of ["Nome", "Avaliação", "Categoria", "Endereço", "Horário", "Telefone", "Site"]) {
      headRow.appendChild(el("th", "", label));
    }
    thead.appendChild(headRow);
    const tbody = document.createElement("tbody");
    for (const place of state.places) {
      const row = document.createElement("tr");
      if (state.activeKey && state.activeKey === place.key) row.className = "active";
      row.append(
        nameCell(place),
        textCell(place.avaliacao),
        textCell(place.categoria),
        clampCell(place.endereco),
        clampCell(place.horario),
        textCell(place.telefone || (state.activeKey === place.key ? "…" : "—"), place.erro),
        siteCell(place)
      );
      tbody.appendChild(row);
    }
    table.append(thead, tbody);
    ui.tableWrap.replaceChildren(table);
    ui.tableWrap.scrollTop = scrollTop;
    if (state.activeKey) ui.tableWrap.querySelector("tr.active")?.scrollIntoView({ block: "nearest" });
    if (state.status) ui.status.textContent = state.status;
  }

  function chip(label, value) {
    const node = el("span", "chip");
    node.append(document.createTextNode(`${label} `), el("strong", "", String(value)));
    return node;
  }

  function nameCell(place) {
    const cell = document.createElement("td");
    const link = el("a", "name", place.nome);
    link.href = place.link;
    link.target = "_blank";
    link.rel = "noreferrer";
    cell.appendChild(link);
    return cell;
  }

  function textCell(value, title) {
    const cell = el("td", value && value !== "…" && value !== "—" && value !== "erro" ? "" : "muted", value || "—");
    if (title) cell.title = title;
    return cell;
  }

  function clampCell(value) {
    const cell = document.createElement("td");
    const clamp = el("div", "clamp", value || "—");
    if (!value) clamp.classList.add("muted");
    clamp.title = value || "";
    cell.appendChild(clamp);
    return cell;
  }

  function siteCell(place) {
    const cell = document.createElement("td");
    if (!place.site) {
      cell.className = "muted";
      cell.textContent = state.activeKey === place.key ? "…" : "—";
      if (place.erro) cell.title = place.erro;
      return cell;
    }
    const link = el("a", "site", hostname(place.site));
    link.href = place.site;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.title = place.site;
    cell.appendChild(link);
    return cell;
  }

  function hostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  function downloadCsv() {
    const blob = new Blob([Parser.toCsv(state.places)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const day = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `estabelecimentos-maps-${day}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyTable() {
    const rows = state.places.map((place) =>
      [place.nome, place.link, place.endereco, place.horario, place.telefone, place.site, place.avaliacao, place.categoria].join("\t")
    );
    const text = ["nome\tlink\tendereco\thorario\ttelefone\tsite\tavaliacao\tcategoria", ...rows].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Tabela copiada. Pode colar numa planilha.");
    } catch {
      setStatus("Não foi possível copiar. Use o botão CSV.");
    }
  }

  function togglePanel() {
    ensurePanel();
    const hidden = host.style.display === "none";
    if (host.style.display === "none" || !host.isConnected) {
      host.style.display = "";
      if (!host.isConnected) document.documentElement.appendChild(host);
      if (!state.places.length || hidden) refreshList();
      return;
    }
    if (!state.places.length) {
      refreshList();
      return;
    }
    host.style.display = "none";
    state.stopRequested = true;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "TOGGLE") {
      togglePanel();
      sendResponse({ ok: true });
    }
    return false;
  });
})();
