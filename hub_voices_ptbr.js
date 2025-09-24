
/**
 * hub_voices_ptbr.js
 * Overlay module to curate PT-BR voices for archetypes on iOS (and cross‑browser),
 * without touching the rest of HUB UNO.
 *
 * It fills #voicesWrap (Brain ▸ “Vozes dos Arquétipos”) with per‑archetype selectors,
 * detects the best native voices (Luciana, Felipe, Joana, Joaquim…) and exposes a
 * tiny API for the Archetype iFrames to request speech via postMessage.
 *
 * Safe to drop in: it doesn’t override existing globals; it only adds window.ArchetypeVoices.
 */
(function () {
  const LS_PREFIX = "infodose:voice:";
  const LS_PROVIDER = "infodose:tts:provider"; // 'browser' | 'azure' | 'polly' | 'eleven' (future)
  const voicesWrap = document.querySelector("#voicesWrap");
  if (!voicesWrap) return; // Nothing to do if Brain UI is not present yet

  // ————————————————————————————————————————————————————————————————————————————
  // Archetypes list (editable). You can add/remove freely.
  // Order matters for the UI.
  const ARCHETYPES = [
    "Luxara", "Nova", "Elysha", "Kaion", "Serena", "Aion",
    "Velor", "Naira", "Sylon", "Thenir", "Rhea", "Lumine", "Genus", "Kaos", "Atlas", "Artemis", "Vitalis", "Solus"
  ];

  // Preferred candidates per archetype (first match wins).
  // Each entry is matched against voice.name (case‑insensitive “includes”)
  // and, if prefixed with 'lang:', against voice.lang.
  const VOICE_PREFS = {
    Luxara: ["Luciana", "Joana", "Google portugu\u00EAs do Brasil", "lang:pt-BR", "lang:pt-PT"],
    Nova: ["Luciana", "Google portugu\u00EAs do Brasil", "Joana", "lang:pt-BR"],
    Elysha: ["Joana", "Luciana", "lang:pt-PT", "lang:pt-BR"],
    Kaion: ["Felipe", "Joaquim", "Google portugu\u00EAs do Brasil", "lang:pt-BR", "lang:pt-PT"],
    Serena: ["Luciana", "lang:pt-BR", "Joana"],
    Aion: ["Felipe", "lang:pt-BR"],
    Velor: ["Felipe", "Luciana", "lang:pt-BR"],
    Naira: ["Luciana", "lang:pt-BR"],
    Sylon: ["Felipe", "lang:pt-BR"],
    Thenir: ["Luciana", "lang:pt-BR"],
    Rhea: ["Luciana", "lang:pt-BR"],
    Lumine: ["Luciana", "lang:pt-BR"],
    Genus: ["Felipe", "lang:pt-BR"],
    Kaos: ["Felipe", "lang:pt-BR"],
    Atlas: ["Felipe", "Luciana", "lang:pt-BR"],
    Artemis: ["Luciana", "lang:pt-BR"],
    Vitalis: ["Felipe", "Luciana", "lang:pt-BR"],
    Solus: ["Luciana", "lang:pt-BR"]
  };

  // Sample test sentence per archetype (fallback has tokens).
  const TEST_LINES = {
    Luxara: "Eu sou a Luxara. Vamos brilhar com eleg\u00E2ncia.",
    Nova: "Eu sou a Nova. Bora desbloquear ideias.",
    Elysha: "Eu sou a Elysha. Presen\u00E7a e claridade.",
    Kaion: "Eu sou o Kaion. Engenharia do pulso, em a\u00E7\u00E3o.",
    Serena: "Eu sou a Serena. Respira\u2026 eu estou com você.",
    Aion: "Eu sou o Aion. Micro\u00E7\u00F5es, grande evolu\u00E7\u00E3o."
  };

  // ————————————————————————————————————————————————————————————————————————————
  // Utility: robust voice loading on iOS/Safari (polling; onvoiceschanged is flaky).
  function loadVoices(timeoutMs = 2000) {
    return new Promise((resolve) => {
      let tries = 0;
      function grab() {
        const list = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
        if (list && list.length) return resolve(list);
        if (++tries * 100 >= timeoutMs) return resolve(list || []);
        setTimeout(grab, 100);
      }
      grab();
    });
  }

  // Normalize a voice label (UI friendly)
  function labelFor(v) {
    const localTag = v.localService ? "local" : "online";
    return `${v.name}  ·  ${v.lang}  ·  ${localTag}`;
  }

  // Match logic for a given archetype with a list of available voices.
  function pickVoice(archetype, voices, savedName) {
    if (!voices || !voices.length) return null;
    // Saved exact name wins
    if (savedName) {
      const exact = voices.find(v => v.name === savedName);
      if (exact) return exact;
    }
    const prefs = VOICE_PREFS[archetype] || [];
    // Rank voices by: (candidate order) + prefer localService + prefer pt-BR over pt-PT
    const scored = voices.map(v => {
      const name = (v.name || "").toLowerCase();
      const lang = (v.lang || "").toLowerCase();
      let score = 0;
      // language preference
      if (lang.startsWith("pt-br")) score += 3;
      if (lang.startsWith("pt-pt")) score += 2;
      // candidate hits
      prefs.forEach((c, idx) => {
        if (c.startsWith("lang:")) {
          const l = c.split(":")[1].toLowerCase();
          if (lang === l) score += 10 - idx; // decreasing weight
        } else if (name.includes(c.toLowerCase())) {
          score += 12 - idx; // name match is a bit stronger
        }
      });
      if (v.localService) score += 1.5;
      return { v, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0] && scored[0].score > 0 ? scored[0].v : null;
    // If nothing scored, pick any pt-* voice
    return best || voices.find(v => /^pt/i.test(v.lang)) || voices[0] || null;
  }

  function speakWithVoice(voice, text) {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis) return reject(new Error("SpeechSynthesis n\u00E3o suportado."));
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice || null;
      // Reasonable defaults for PT‑BR
      u.lang = (voice && voice.lang) || "pt-BR";
      u.rate = 1.0;
      u.pitch = 1.0;
      u.onend = () => resolve();
      u.onerror = (e) => reject(e.error || e);
      // Workaround iOS quirk: cancel any pending to avoid queue jam
      try { window.speechSynthesis.cancel(); } catch {}
      window.speechSynthesis.speak(u);
    });
  }

  function getSaved(archetype) {
    try { return localStorage.getItem(LS_PREFIX + archetype) || "auto"; }
    catch { return "auto"; }
  }
  function saveChoice(archetype, val) {
    try {
      if (!val || val === "auto") localStorage.removeItem(LS_PREFIX + archetype);
      else localStorage.setItem(LS_PREFIX + archetype, val);
    } catch {}
  }

  function buildRow({ archetype, voices, saved }) {
    const row = document.createElement("div");
    row.className = "menuItem"; // reuse Hub style
    row.innerHTML = `
      <div style="font-weight:800;min-width:120px">${archetype}</div>
      <select class="input ring" style="flex:1;max-width:380px"></select>
      <div style="display:flex;gap:6px">
        <button class="btn fx-trans fx-press ring" data-act="test">Testar</button>
        <button class="btn fx-trans fx-press ring" data-act="save">Salvar</button>
        <button class="btn fx-trans fx-press ring" data-act="reset">Resetar</button>
      </div>
    `;
    const sel = row.querySelector("select");
    // Build options: Auto + available PT voices first, then others
    const opts = [];
    const ptVoices = voices.filter(v => /^pt/i.test(v.lang));
    const otherVoices = voices.filter(v => !/^pt/i.test(v.lang));
    function pushOpt(val, label) {
      const o = document.createElement("option");
      o.value = val; o.textContent = label;
      sel.appendChild(o);
    }
    pushOpt("auto", "Auto (melhor PT • din\u00E2mico)");
    ptVoices.forEach(v => pushOpt(v.name, labelFor(v)));
    if (otherVoices.length) {
      const grp = document.createElement("optgroup");
      grp.label = "Outros (fallback)";
      otherVoices.forEach(v => {
        const o = document.createElement("option");
        o.value = v.name; o.textContent = labelFor(v);
        grp.appendChild(o);
      });
      sel.appendChild(grp);
    }
    sel.value = saved || "auto";
    // Events
    row.addEventListener("click", async (ev) => {
      const btn = ev.target.closest("button");
      if (!btn) return;
      const action = btn.getAttribute("data-act");
      if (action === "reset") {
        sel.value = "auto";
      } else if (action === "save") {
        saveChoice(archetype, sel.value);
        toast(`Voz de ${archetype} salva: ${sel.value}`);
      } else if (action === "test") {
        const savedName = sel.value === "auto" ? null : sel.value;
        const voice = pickVoice(archetype, voices, savedName);
        const phrase = TEST_LINES[archetype] || `Ol\u00E1, eu sou ${archetype}. Pronto para agir.`;
        try {
          btn.disabled = true;
          await speakWithVoice(voice, phrase);
        } catch (e) {
          console.warn("speak error", e);
          alert("Falha ao falar nesta voz. Tente outra.");
        } finally {
          btn.disabled = false;
        }
      }
    });
    return row;
  }

  function toast(msg) {
    // Minimal non-intrusive toast using Hub's #lsx-toastBox if present
    let box = document.querySelector("#lsx-toastBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "lsx-toastBox";
      box.style.position = "fixed";
      box.style.right = "14px";
      box.style.bottom = "88px";
      box.style.display = "grid";
      box.style.gap = "8px";
      box.style.zIndex = "2147483002";
      document.body.appendChild(box);
    }
    const el = document.createElement("div");
    el.className = "lsx-toast";
    el.style.background = "linear-gradient(90deg,#1b2a2a,#123c2e)";
    el.style.color = "#eaf0ff";
    el.style.border = "1px solid #ffffff22";
    el.style.padding = ".6rem .8rem";
    el.style.borderRadius = "12px";
    el.style.boxShadow = "0 10px 30px rgba(0,0,0,.35)";
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.remove(); }, 2400);
  }

  // ————————————————————————————————————————————————————————————————————————————
  // Public API for iFrames (postMessage) and direct calls.
  const API = {
    getVoiceName(archetype) { return getSaved(archetype); },
    async getBestVoice(archetype) {
      const voices = await loadVoices();
      const saved = getSaved(archetype);
      return pickVoice(archetype, voices, saved === "auto" ? null : saved);
    },
    async speak(archetype, text) {
      const voice = await API.getBestVoice(archetype);
      if (!voice) throw new Error("Nenhuma voz PT encontrada");
      return speakWithVoice(voice, text);
    },
    /** Choose global provider; reserved for future remote engines (Azure/Polly/ElevenLabs). */
    setProvider(provider) {
      try { localStorage.setItem(LS_PROVIDER, provider); } catch {}
    },
    getProvider() {
      try { return localStorage.getItem(LS_PROVIDER) || "browser"; } catch { return "browser"; }
    }
  };
  Object.defineProperty(window, "ArchetypeVoices", { value: API, configurable: false });

  // Listen to messages from Archetype iFrames: {type:'speak', arch, text}
  window.addEventListener("message", (ev) => {
    const msg = ev && ev.data;
    if (!msg || msg.type !== "speak") return;
    const arch = msg.arch || msg.archetype || "Luxara";
    const text = msg.text || "";
    if (!text) return;
    API.speak(arch, text).catch(console.warn);
  }, false);

  // ————————————————————————————————————————————————————————————————————————————
  // Build the Brain UI
  (async function initUI() {
    const voices = await loadVoices();
    // Keep a stable order: pt-* voices first
    voices.sort((a, b) => {
      const aPT = /^pt/i.test(a.lang) ? 1 : 0;
      const bPT = /^pt/i.test(b.lang) ? 1 : 0;
      if (aPT !== bPT) return bPT - aPT;
      return String(a.name).localeCompare(String(b.name));
    });
    voicesWrap.innerHTML = ""; // reset
    ARCHETYPES.forEach(arch => {
      const row = buildRow({ archetype: arch, voices, saved: getSaved(arch) });
      voicesWrap.appendChild(row);
    });
    // Hint for iOS users to download "Enhanced" voices from Settings if missing.
    const note = document.createElement("div");
    note.className = "notice";
    note.style.marginTop = "6px";
    note.textContent = "Dica: no iPhone, se 'Luciana' ou 'Felipe' n\u00E3o aparecerem, baixe as vozes de alta qualidade em Ajustes ▸ Acessibilidade ▸ Conte\u00FAdo falado / Vozes.";
    voicesWrap.parentElement.appendChild(note);
  })();

  // ————————————————————————————————————————————————————————————————————————————
  // UX clarity: clarify “Voltar” vs “Atualizar” tooltips when LS panel opens.
  const mo = new MutationObserver(() => {
    const back = document.querySelector("#btnBack");
    if (back && !back.dataset._clarified) {
      back.title = "Voltar \u2022 volta para a tela anterior (Home/Apps/Stack/Brain)";
      back.dataset._clarified = "1";
    }
    const lsx = document.querySelector("#lsx-panel");
    if (lsx && !lsx.dataset._clarified) {
      const refresh = lsx.querySelector("#lsx-refresh");
      if (refresh) refresh.title = "Atualizar \u2022 revarre as chaves do Brain (LocalStorage) \u2013 n\u00E3o \u00E9 'voltar'";
      lsx.dataset._clarified = "1";
    }
  });
  mo.observe(document.documentElement, { subtree: true, childList: true });
})();
