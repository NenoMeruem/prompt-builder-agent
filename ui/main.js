// Tauri API — use window.__TAURI__ (Tauri v2 plain HTML, no bundler)
const _tauri = window.__TAURI__;
const invoke = _tauri
  ? _tauri.core.invoke
  : async (cmd, args) => { console.warn('Tauri not available:', cmd, args); return '[]'; };
const listen = _tauri
  ? _tauri.event.listen
  : async () => {};

// ── State ─────────────────────────────────────────────────────────────────────
let activeRecipe  = null;
let editingRecipe = null;
let pendingDeleteId     = null;  // recipe
let pendingDeleteEngine = null;  // engine
let engineConfigs = {};
let allRecipes    = [];   // full list cache for re-render
let filteredRecipes = []; // recipes matching current #cmd-search query
let searchQuery   = '';
let currentView   = 'input';
let isContextDrawerOpen = false;
// Keyboard navigation index across [filteredRecipes..., filteredQuickActions...]
let paletteSelectedIndex = 0;

const paramValues = { tone: 'casual', length: 'short', complexity: 'normal' };

const PARAM_CONFIG = {
  tone:       { label: 'Style',      emoji: '', options: ['professional', 'casual', 'concise'] },
  length:     { label: 'Length',     emoji: '', options: ['short', 'medium', 'long'] },
  complexity: { label: 'Complexity', emoji: '', options: ['simple', 'normal', 'technical'] },
};

const ENGINE_MODELS = {
  gemini: [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
  ],
  claude: [
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest',
    'claude-3-opus-latest',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'o3-mini',
  ],
  ollama: [
    'llama3.2',
    'deepseek-r1:8b',
    'qwen2.5-coder:7b',
    'mistral',
  ],
};

// ── Quick Actions in Command Palette (look / Raycast style) ──────────────────
const QUICK_ACTIONS = [
  {
    id: 'qa_new_recipe',
    name: 'Create New Recipe',
    desc: 'Build a single prompt template or multi-step LCEL pipeline',
    icon: '➕',
    kbd: '⌘N',
    keywords: 'new add create recipe chain pipeline template',
    run: () => openCreateForm(),
  },
  {
    id: 'qa_edit_context',
    name: 'Edit Selection / Clipboard Text',
    desc: 'Expand or edit the text injected into {{selection}}',
    icon: '📝',
    kbd: 'Tab',
    keywords: 'clipboard selection context input text paste edit',
    run: () => toggleContextDrawer(true, true),
  },
  {
    id: 'qa_history',
    name: 'View Run History',
    desc: 'Browse past prompt executions and multi-turn threads',
    icon: '🕒',
    kbd: '⌘Y',
    keywords: 'history log past runs conversations threads',
    run: () => { showView('history'); loadHistory(); },
  },
  {
    id: 'qa_settings',
    name: 'AI Engines & Settings',
    desc: 'Configure API keys, models, global hotkey, and backup',
    icon: '⚙️',
    kbd: '⌘,',
    keywords: 'settings config engines api key model hotkey theme backup',
    run: () => openSettingsView(),
  },
  {
    id: 'qa_appearance',
    name: 'Theme, Opacity & Wallpaper',
    desc: 'Switch between Catppuccin, Tokyo Night, Rosé Pine, Dracula, custom background & opacity',
    icon: '🎨',
    kbd: '⌘T',
    keywords: 'theme catppuccin tokyo night rose pine dracula wallpaper background image opacity blur appearance',
    run: async () => {
      await openSettingsView();
      switchSettingsTab('appearance');
    },
  },
  {
    id: 'qa_theme_dark',
    name: 'Toggle Dark / Light Mode',
    desc: 'Switch between light and dark frosted glass appearance',
    icon: '🌗',
    kbd: '⌘D',
    keywords: 'dark light mode theme appearance color',
    run: () => applyDark(document.documentElement.dataset.dark !== 'true'),
  },
];

let filteredQuickActions = [...QUICK_ACTIONS];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const outputEl          = document.getElementById('output');
const runBtn            = document.getElementById('run-btn');
const copyBtn           = document.getElementById('copy-btn');
const copyWrapEl        = document.getElementById('copy-wrap');
const copyFmtToggle     = document.getElementById('copy-fmt-toggle');
const copyFmtMenu       = document.getElementById('copy-fmt-menu');
const closeBtn          = document.getElementById('close-btn');
const backBtn           = document.getElementById('back-btn');
const omnibarBackBtn    = document.getElementById('omnibar-back-btn');
const omnibarSearchWrap = document.getElementById('omnibar-search-wrap');
const omnibarBreadcrumb = document.getElementById('omnibar-breadcrumb');
const cmdSearchInput    = document.getElementById('cmd-search');
const cmdSearchClear    = document.getElementById('cmd-search-clear');
const contextPill       = document.getElementById('context-pill');
const contextPillText   = document.getElementById('context-pill-text');
const contextStrip      = document.getElementById('context-strip');
const contextSnippet    = document.getElementById('context-snippet');
const contextMeta       = document.getElementById('context-meta');
const contextToggleBtn  = document.getElementById('context-toggle-btn');
const contextDrawer     = document.getElementById('context-drawer');
const addRecipeBtn      = document.getElementById('add-recipe-btn');
const formCancelBtn     = document.getElementById('form-cancel-btn');
const formSaveBtn       = document.getElementById('form-save-btn');
const formTitle         = document.getElementById('form-title');
const formError         = document.getElementById('form-error');
const recipeListEl      = document.getElementById('recipe-list');
const quickActionsListEl = document.getElementById('quick-actions-list');
const recipesGroupHeader = document.getElementById('recipes-group-header');
const quickActionsHeader = document.getElementById('quick-actions-header');
const inputArea         = document.getElementById('input-area');
const instructionText   = document.getElementById('instruction-text');
const breadcrumbPage    = document.getElementById('breadcrumb-page');
const paramsSection     = document.getElementById('params-section');
const viewInput         = document.getElementById('view-input');
const viewOutput        = document.getElementById('view-output');
const viewForm          = document.getElementById('view-form');
const viewSettings      = document.getElementById('view-settings');
const viewHistory       = document.getElementById('view-history');
const settingsBtn       = document.querySelector('.hbtn[title^="Settings"]');
const settingsCloseBtn  = document.getElementById('settings-close-btn');
const settingsMsg       = document.getElementById('settings-msg');
const footerStatusText  = document.getElementById('footer-status-text');
const footerShortcuts   = document.getElementById('footer-shortcuts');

// ── Markdown renderer ─────────────────────────────────────────────────────────

function escapeHtml(s) {
  if (!s || typeof s !== 'string') return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function inlineMd(text) {
  if (!text || typeof text !== 'string') return '';
  text = escapeHtml(text);
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  text = text.replace(/_([^_\n]+?)_/g, '<em>$1</em>');
  text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return text;
}

function renderMarkdown(raw, _depth = 0) {
  if (!raw || typeof raw !== 'string') return '';
  if (_depth > 4) return escapeHtml(raw);

  try {
    const fences = [];
    const fenceLines = raw.split('\n');
    const processedLines = [];
    let inFence = false;
    let fenceLang = '';
    let fenceContent = [];
    for (const fl of fenceLines) {
      if (!inFence) {
        const fm = fl.match(/^```\s*([\w.-]*)/);
        if (fm) { inFence = true; fenceLang = fm[1]; fenceContent = []; }
        else { processedLines.push(fl); }
      } else {
        if (fl.trim() === '```') {
          fences.push({ lang: fenceLang, code: fenceContent.join('\n') });
          processedLines.push(`\x01F${fences.length - 1}\x01`);
          inFence = false;
        } else { fenceContent.push(fl); }
      }
    }
    if (inFence) {
      fences.push({ lang: fenceLang, code: fenceContent.join('\n') });
      processedLines.push(`\x01F${fences.length - 1}\x01`);
    }
    let md = processedLines.join('\n');

    const lines  = md.split('\n');
    const out    = [];
    let i        = 0;

    const flushFence = (token) => {
      const match = token.match(/\d+/);
      if (!match) return '';
      const idx = parseInt(match[0], 10);
      const fence = fences[idx];
      if (!fence) return `<pre class="md-pre"><code>${escapeHtml(token)}</code></pre>`;
      const label = fence.lang ? `<span class="md-code-lang">${escapeHtml(fence.lang)}</span>` : '';
      return `<pre class="md-pre">${label}<code class="md-code-block">${escapeHtml(fence.code)}</code></pre>`;
    };

    while (i < lines.length) {
      const line = lines[i];

      if (/^\x01F\d+\x01$/.test(line.trim())) {
        out.push(flushFence(line.trim()));
        i++; continue;
      }
      const hm = line.match(/^(#{1,6}) (.+)/);
      if (hm) {
        const lvl = Math.min(hm[1].length, 6);
        out.push(`<h${lvl} class="md-h${lvl}">${inlineMd(hm[2].trim())}</h${lvl}>`);
        i++; continue;
      }
      if (/^[-*_]{3,}$/.test(line.trim())) {
        out.push('<hr class="md-hr">');
        i++; continue;
      }
      if (line.startsWith('> ')) {
        const qlines = [];
        while (i < lines.length && lines[i].startsWith('> ')) { qlines.push(lines[i].slice(2)); i++; }
        out.push(`<blockquote class="md-blockquote">${renderMarkdown(qlines.join('\n'), _depth + 1)}</blockquote>`);
        continue;
      }
      if (/^[-*+] /.test(line)) {
        const items = [];
        while (i < lines.length && /^[-*+] /.test(lines[i])) {
          items.push(`<li>${inlineMd(lines[i].replace(/^[-*+] /, ''))}</li>`);
          i++;
        }
        out.push(`<ul class="md-ul">${items.join('')}</ul>`);
        continue;
      }
      if (/^\d+[.)]\s/.test(line)) {
        const items = [];
        while (i < lines.length && /^\d+[.)]\s/.test(lines[i])) {
          items.push(`<li>${inlineMd(lines[i].replace(/^\d+[.)]\s/, ''))}</li>`);
          i++;
        }
        out.push(`<ol class="md-ol">${items.join('')}</ol>`);
        continue;
      }
      if (line.trim() === '') { i++; continue; }

      const plines = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === '') break;
        if (/^\x01F\d+\x01$/.test(l.trim())) break;
        if (/^#{1,6} /.test(l)) break;
        if (/^[-*_]{3,}$/.test(l.trim())) break;
        if (/^[-*+] /.test(l)) break;
        if (/^\d+[.)]\s/.test(l)) break;
        if (l.startsWith('> ')) break;
        plines.push(inlineMd(l));
        i++;
      }
      if (plines.length) out.push(`<p class="md-p">${plines.join('<br>')}</p>`);
    }

    return out.join('');
  } catch (err) {
    console.error('renderMarkdown error, returning escaped text:', err);
    return `<p class="md-p">${escapeHtml(raw)}</p>`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sparkleIcon() {
  return `<svg viewBox="0 0 20 20" fill="currentColor">
    <path d="M10 1.5 L11.4 8.6 L18.5 10 L11.4 11.4 L10 18.5 L8.6 11.4 L1.5 10 L8.6 8.6 Z"/>
    <path d="M4.5 4.5 L5.1 6.4 L7 5 L5.1 5.6 Z" opacity="0.45"/>
    <path d="M15.5 4.5 L15.4 6.4 L13.8 5 L15.4 5.6 Z" opacity="0.45"/>
    <path d="M4.5 15.5 L5.1 13.6 L7 15 L5.1 14.4 Z" opacity="0.45"/>
    <path d="M15.5 15.5 L15.4 13.6 L13.8 15 L15.4 14.4 Z" opacity="0.45"/>
  </svg>`;
}

function editIcon() {
  return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14.5 2.5a2.121 2.121 0 013 3L6 17l-4 1 1-4 11.5-11.5z"/>
  </svg>`;
}

function trashIcon() {
  return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 5 5 5 17 5"/>
    <path d="M8 5V3h4v2M5 5l1 11h8l1-11"/>
  </svg>`;
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function slugify(s) {
  return s.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// ── Dynamic Window Sizing & Footer Updates ────────────────────────────────────

function updateWindowSizeForView(viewName) {
  let targetHeight = 500;
  if (viewName === 'input') {
    targetHeight = isContextDrawerOpen ? 560 : 480;
  } else {
    targetHeight = 580;
  }
  invoke('resize_window', { width: 740, height: targetHeight }).catch(() => {});
}

function updateFooterBar() {
  if (!footerStatusText || !footerShortcuts) return;

  if (currentView === 'input') {
    if (activeRecipe) {
      const eng = activeRecipe.engine || Object.keys(engineConfigs)[0] || 'gemini';
      const engName = engineConfigs[eng]?.name || capitalize(eng);
      const isChain = Array.isArray(activeRecipe.steps) && activeRecipe.steps.length > 0;
      const modeLabel = isChain ? `Pipeline (${activeRecipe.steps.length} steps)` : engName;
      footerStatusText.textContent = `${activeRecipe.name} • ${modeLabel}`;
    } else {
      footerStatusText.textContent = 'Select a recipe or command';
    }
    footerShortcuts.innerHTML = `
      <span class="footer-sc"><kbd>↑↓</kbd> Navigate</span>
      <span class="footer-sc"><kbd>↵</kbd> Run</span>
      <span class="footer-sc"><kbd>Tab</kbd> Context</span>
      <span class="footer-sc"><kbd>⌘E</kbd> Edit</span>
      <span class="footer-sc"><kbd>Esc</kbd> Close</span>
    `;
  } else if (currentView === 'output') {
    const eng = conversationEngine || activeRecipe?.engine || 'AI';
    footerStatusText.textContent = `Streaming Response • ${engineConfigs[eng]?.name || eng}`;
    footerShortcuts.innerHTML = `
      <span class="footer-sc"><kbd>↵</kbd> Follow-up</span>
      <span class="footer-sc"><kbd>⌘C</kbd> Copy</span>
      <span class="footer-sc"><kbd>Esc</kbd> Back</span>
    `;
  } else if (currentView === 'form') {
    footerStatusText.textContent = editingRecipe ? `Editing: ${editingRecipe.name}` : 'Creating New Recipe';
    footerShortcuts.innerHTML = `
      <span class="footer-sc"><kbd>Esc</kbd> Cancel</span>
    `;
  } else if (currentView === 'history') {
    footerStatusText.textContent = 'Execution History';
    footerShortcuts.innerHTML = `
      <span class="footer-sc"><kbd>Click</kbd> Expand</span>
      <span class="footer-sc"><kbd>Esc</kbd> Back</span>
    `;
  } else if (currentView === 'settings') {
    footerStatusText.textContent = 'Promptly Settings';
    footerShortcuts.innerHTML = `
      <span class="footer-sc"><kbd>Esc</kbd> Back</span>
    `;
  }
}

// ── Context Strip & Collapsible Drawer ────────────────────────────────────────

function toggleContextDrawer(forceOpen, focusTextarea = false) {
  isContextDrawerOpen = typeof forceOpen === 'boolean' ? forceOpen : !isContextDrawerOpen;
  if (contextDrawer) contextDrawer.classList.toggle('hidden', !isContextDrawerOpen);
  if (contextPill) contextPill.classList.toggle('open', isContextDrawerOpen);
  if (contextToggleBtn) {
    contextToggleBtn.textContent = isContextDrawerOpen ? 'Hide Text ▴' : 'Edit Text ▾';
  }
  updateWindowSizeForView(currentView);

  if (isContextDrawerOpen && focusTextarea && inputArea) {
    setTimeout(() => inputArea.focus(), 20);
  } else if (!isContextDrawerOpen && currentView === 'input' && cmdSearchInput) {
    setTimeout(() => cmdSearchInput.focus(), 20);
  }
}

function updateContextUI() {
  const val = (inputArea?.value || '').trim();
  const hasText = val.length > 0;

  if (contextPill) {
    contextPill.classList.toggle('has-text', hasText);
  }

  if (!hasText) {
    if (contextPillText) contextPillText.textContent = '📋 No Context';
    if (contextSnippet) {
      contextSnippet.textContent = 'No clipboard text — press Tab or click here to type input…';
      contextSnippet.classList.add('empty');
    }
    if (contextMeta) contextMeta.textContent = '';
  } else {
    const words = val.split(/\s+/).filter(Boolean).length;
    const lines = val.split('\n').length;
    const metaLabel = lines > 1 ? `${lines} lines • ${words}w` : `${words} words`;
    if (contextPillText) contextPillText.textContent = `📋 ${words}w`;
    if (contextSnippet) {
      const singleLine = val.replace(/\s+/g, ' ').slice(0, 95);
      contextSnippet.textContent = singleLine + (val.length > 95 ? '…' : '');
      contextSnippet.classList.remove('empty');
    }
    if (contextMeta) contextMeta.textContent = metaLabel;
  }
}

if (contextPill) {
  contextPill.addEventListener('click', () => {
    if (currentView !== 'input') showView('input');
    toggleContextDrawer(undefined, true);
  });
}
if (contextStrip) {
  contextStrip.addEventListener('click', (e) => {
    if (e.target.closest('#context-toggle-btn')) return;
    toggleContextDrawer(undefined, true);
  });
}
if (contextToggleBtn) {
  contextToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleContextDrawer(undefined, true);
  });
}

// ── View switching ────────────────────────────────────────────────────────────

function showView(name) {
  currentView = name;
  viewInput.style.display  = name === 'input'    ? 'flex' : 'none';
  viewOutput.classList.toggle('visible',   name === 'output');
  viewForm.classList.toggle('visible',     name === 'form');
  viewSettings.classList.toggle('visible', name === 'settings');
  viewHistory.classList.toggle('visible',  name === 'history');

  const isLauncher = name === 'input';
  if (omnibarBackBtn)    omnibarBackBtn.classList.toggle('hidden', isLauncher);
  if (omnibarSearchWrap) omnibarSearchWrap.classList.toggle('hidden', !isLauncher);
  if (omnibarBreadcrumb) omnibarBreadcrumb.classList.toggle('hidden', isLauncher);

  if (!isLauncher && breadcrumbPage) {
    if (name === 'output')   breadcrumbPage.textContent = activeRecipe?.name || 'Response';
    if (name === 'form')     breadcrumbPage.textContent = editingRecipe ? 'Edit Recipe' : 'New Recipe';
    if (name === 'history')  breadcrumbPage.textContent = 'Run History';
    if (name === 'settings') breadcrumbPage.textContent = 'Settings';
  }

  updateWindowSizeForView(name);
  updateFooterBar();

  if (isLauncher && cmdSearchInput) {
    setTimeout(() => cmdSearchInput.focus(), 20);
  }
}

if (omnibarBackBtn) {
  omnibarBackBtn.addEventListener('click', () => showView('input'));
}

// ── Command Palette Search & Filtering ────────────────────────────────────────

function filterPaletteItems(query) {
  searchQuery = (query || '').trim().toLowerCase();
  if (cmdSearchClear) {
    cmdSearchClear.classList.toggle('hidden', searchQuery.length === 0);
  }

  if (!searchQuery) {
    filteredRecipes = [...allRecipes];
    filteredQuickActions = [...QUICK_ACTIONS];
  } else {
    filteredRecipes = allRecipes.filter(r => {
      const hay = [
        r.name || '',
        r.description || '',
        r.id || '',
        r.template || '',
        r.engine || '',
        ...(Array.isArray(r.steps) ? r.steps.map(s => `${s.name} ${s.step_id}`) : []),
      ].join(' ').toLowerCase();
      return hay.includes(searchQuery);
    });

    filteredQuickActions = QUICK_ACTIONS.filter(qa => {
      const hay = `${qa.name} ${qa.desc} ${qa.keywords}`.toLowerCase();
      return hay.includes(searchQuery);
    });
  }

  // Keep selected index in bounds
  const totalItems = filteredRecipes.length + filteredQuickActions.length;
  if (filteredRecipes.length > 0) {
    const activeIdx = activeRecipe ? filteredRecipes.findIndex(r => r.id === activeRecipe.id) : -1;
    paletteSelectedIndex = activeIdx >= 0 ? activeIdx : 0;
    selectRecipe(filteredRecipes[paletteSelectedIndex], false);
  } else if (totalItems > 0) {
    paletteSelectedIndex = 0;
  } else {
    paletteSelectedIndex = -1;
  }

  renderRecipeList(filteredRecipes);
  renderQuickActionsList(filteredQuickActions);
  syncPaletteHighlight();
}

if (cmdSearchInput) {
  cmdSearchInput.addEventListener('input', (e) => {
    filterPaletteItems(e.target.value);
  });
}

if (cmdSearchClear) {
  cmdSearchClear.addEventListener('click', () => {
    if (cmdSearchInput) {
      cmdSearchInput.value = '';
      filterPaletteItems('');
      cmdSearchInput.focus();
    }
  });
}

function syncPaletteHighlight() {
  const recipeEls = [...recipeListEl.querySelectorAll('.recipe-item')];
  const qaEls     = [...(quickActionsListEl ? quickActionsListEl.querySelectorAll('.quick-action-item') : [])];

  recipeEls.forEach((el, idx) => {
    const isSel = idx === paletteSelectedIndex;
    el.classList.toggle('active', isSel);
    if (isSel) el.scrollIntoView({ block: 'nearest' });
  });

  qaEls.forEach((el, idx) => {
    const globalIdx = filteredRecipes.length + idx;
    const isSel = globalIdx === paletteSelectedIndex;
    el.classList.toggle('active', isSel);
    if (isSel) el.scrollIntoView({ block: 'nearest' });
  });
}

function movePaletteSelection(delta) {
  const total = filteredRecipes.length + filteredQuickActions.length;
  if (total === 0) return;

  paletteSelectedIndex = (paletteSelectedIndex + delta + total) % total;
  if (paletteSelectedIndex < filteredRecipes.length) {
    const recipe = filteredRecipes[paletteSelectedIndex];
    if (recipe) selectRecipe(recipe, false);
  }
  syncPaletteHighlight();
}

function triggerSelectedPaletteItem() {
  const total = filteredRecipes.length + filteredQuickActions.length;
  if (total === 0 || paletteSelectedIndex < 0) return;

  if (paletteSelectedIndex < filteredRecipes.length) {
    const recipe = filteredRecipes[paletteSelectedIndex];
    if (recipe) {
      selectRecipe(recipe, false);
      executeActiveRecipeOrPromptInput();
    }
  } else {
    const qaIdx = paletteSelectedIndex - filteredRecipes.length;
    const qa = filteredQuickActions[qaIdx];
    if (qa && typeof qa.run === 'function') {
      qa.run();
    }
  }
}

function executeActiveRecipeOrPromptInput() {
  if (!activeRecipe) return;
  const text = (inputArea?.value || '').trim();
  if (!text) {
    // Open context drawer and focus textarea so user can type input
    toggleContextDrawer(true, true);
    return;
  }
  runBtn.click();
}

// ── Recipes ───────────────────────────────────────────────────────────────────
async function loadRecipes() {
  try {
    const json = await invoke('list_recipes');
    const recipes = JSON.parse(json);
    allRecipes = recipes;
    filteredRecipes = [...recipes];

    const lastId = localStorage.getItem('pa_last');
    const toSelect = recipes.find(r => r.id === lastId) || recipes[0];
    if (toSelect) {
      paletteSelectedIndex = Math.max(0, recipes.findIndex(r => r.id === toSelect.id));
      selectRecipe(toSelect, false);
    }

    filterPaletteItems(cmdSearchInput ? cmdSearchInput.value : '');
  } catch (err) {
    console.error('Failed to load recipes:', err);
  }
}

// ── Recipe drag-and-drop (mouse-event based — reliable in Tauri WebView) ──────
let dragState = null; // { srcId, srcEl }

function onDragMove(e) {
  if (!dragState) return;
  recipeListEl.querySelectorAll('.recipe-item').forEach(i => i.classList.remove('drag-over'));
  const els = document.elementsFromPoint(e.clientX, e.clientY);
  const target = els.find(el => el.classList.contains('recipe-item') && el.dataset.id && el.dataset.id !== dragState.srcId);
  if (target) {
    target.classList.add('drag-over');
    dragState.currentTargetId = target.dataset.id;
  } else {
    dragState.currentTargetId = null;
  }
}

async function onDragEnd() {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  if (!dragState) return;

  dragState.srcEl.classList.remove('dragging');
  recipeListEl.querySelectorAll('.recipe-item').forEach(i => i.classList.remove('drag-over'));

  const { srcId, currentTargetId } = dragState;
  dragState = null;

  if (!currentTargetId || currentTargetId === srcId) return;

  const items = [...recipeListEl.querySelectorAll('.recipe-item')];
  const ids = items.map(i => i.dataset.id);
  const srcIdx = ids.indexOf(srcId);
  const dstIdx = ids.indexOf(currentTargetId);
  if (srcIdx === -1 || dstIdx === -1) return;
  ids.splice(srcIdx, 1);
  ids.splice(dstIdx, 0, srcId);

  const idToRecipe = Object.fromEntries(allRecipes.map(x => [x.id, x]));
  allRecipes = ids.map(id => idToRecipe[id]).filter(Boolean);
  filterPaletteItems(cmdSearchInput ? cmdSearchInput.value : '');

  try {
    await invoke('reorder_recipes', { ids });
  } catch (err) {
    console.error('Failed to persist recipe order:', err);
  }
}

function renderRecipeList(recipes) {
  recipeListEl.innerHTML = '';
  if (recipesGroupHeader) {
    recipesGroupHeader.style.display = recipes.length === 0 && searchQuery ? 'none' : 'flex';
  }

  if (recipes.length === 0) {
    if (!searchQuery) {
      recipeListEl.innerHTML = `<div class="palette-empty">No recipes yet. Press <strong>⌘N</strong> to create one.</div>`;
    }
    return;
  }

  recipes.forEach((r, idx) => {
    const isChain = Array.isArray(r.steps) && r.steps.length > 0;
    const chainBadge = isChain
      ? `<span class="recipe-chain-badge" title="Multi-step Pipeline">🔗 ${r.steps.length} steps</span>`
      : '';
    const engBadge = r.engine
      ? `<span class="recipe-engine-pill">${escapeHtml(r.engine)}</span>`
      : '';

    const subtitle = isChain
      ? r.steps.map((s, i) => `${i + 1}. ${s.name || s.step_id}`).join(' ➔ ')
      : (r.description || r.template || '');

    const iconHtml = r.icon && r.icon.trim()
      ? escapeHtml(r.icon.trim())
      : sparkleIcon();

    const el = document.createElement('div');
    el.className = 'recipe-item' + (idx === paletteSelectedIndex ? ' active' : '');
    el.dataset.id = r.id;
    el.innerHTML = `
      <span class="recipe-drag-handle" title="Drag to reorder">⠿</span>
      <span class="recipe-icon">${iconHtml}</span>
      <div class="recipe-main">
        <span class="recipe-name">${escapeHtml(r.name)}</span>
        <span class="recipe-desc">${escapeHtml(subtitle)}</span>
      </div>
      <div class="recipe-right">
        ${chainBadge}
        ${engBadge}
        <div class="recipe-actions">
          <button class="recipe-edit-btn" title="Edit Recipe (⌘E)" data-id="${r.id}">${editIcon()}</button>
          <button class="recipe-del-btn" title="Delete Recipe" data-id="${r.id}">${trashIcon()}</button>
        </div>
        <span class="recipe-enter-hint" title="Click or press Enter to run">↵ Run</span>
      </div>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.closest('.recipe-actions, .recipe-drag-handle')) return;
      if (e.target.closest('.recipe-enter-hint')) {
        paletteSelectedIndex = idx;
        selectRecipe(r, false);
        syncPaletteHighlight();
        executeActiveRecipeOrPromptInput();
        return;
      }
      paletteSelectedIndex = idx;
      selectRecipe(r, false);
      syncPaletteHighlight();
    });

    el.addEventListener('dblclick', (e) => {
      if (e.target.closest('.recipe-actions, .recipe-drag-handle')) return;
      paletteSelectedIndex = idx;
      selectRecipe(r, false);
      syncPaletteHighlight();
      executeActiveRecipeOrPromptInput();
    });

    el.querySelector('.recipe-edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditForm(r);
    });
    el.querySelector('.recipe-del-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      showDeleteConfirm(r);
    });

    // Drag handle
    el.querySelector('.recipe-drag-handle').addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragState = { srcId: r.id, srcEl: el, currentTargetId: null };
      el.classList.add('dragging');
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
    });

    recipeListEl.appendChild(el);
  });
}

function renderQuickActionsList(actions) {
  if (!quickActionsListEl) return;
  quickActionsListEl.innerHTML = '';

  if (quickActionsHeader) {
    quickActionsHeader.style.display = actions.length === 0 ? 'none' : 'flex';
  }

  if (actions.length === 0 && filteredRecipes.length === 0) {
    quickActionsListEl.innerHTML = `<div class="palette-empty">No matching recipes or commands for "${escapeHtml(searchQuery)}".</div>`;
    return;
  }

  actions.forEach((qa, idx) => {
    const globalIdx = filteredRecipes.length + idx;
    const el = document.createElement('div');
    el.className = 'quick-action-item' + (globalIdx === paletteSelectedIndex ? ' active' : '');
    el.dataset.id = qa.id;
    el.innerHTML = `
      <span class="recipe-icon">${qa.icon}</span>
      <div class="recipe-main">
        <span class="recipe-name">${escapeHtml(qa.name)}</span>
        <span class="recipe-desc">${escapeHtml(qa.desc)}</span>
      </div>
      <div class="recipe-right">
        <kbd class="quick-action-kbd">${escapeHtml(qa.kbd)}</kbd>
      </div>
    `;
    el.addEventListener('click', () => {
      paletteSelectedIndex = globalIdx;
      syncPaletteHighlight();
      qa.run();
    });
    quickActionsListEl.appendChild(el);
  });
}

function showDeleteConfirm(recipe) {
  pendingDeleteId = recipe.id;
  const modal = document.getElementById('delete-modal');
  document.getElementById('delete-modal-name').textContent = recipe.name || recipe.id;
  modal.classList.add('visible');
}

function hideDeleteConfirm() {
  pendingDeleteId     = null;
  pendingDeleteEngine = null;
  document.getElementById('delete-modal').classList.remove('visible');
}

async function deleteRecipe(id) {
  try {
    await invoke('delete_recipe', { id });
    if (activeRecipe && activeRecipe.id === id) {
      activeRecipe = null;
      instructionText.textContent = 'Select a recipe to see instructions…';
      instructionText.classList.add('ph');
      paramsSection.innerHTML = '';
      updateRunState();
    }
    await loadRecipes();
  } catch (err) {
    console.error('[delete] error:', err);
  }
}

document.getElementById('delete-modal-cancel').addEventListener('click', hideDeleteConfirm);
document.getElementById('delete-modal-confirm').addEventListener('click', async () => {
  if (pendingDeleteId) {
    const id = pendingDeleteId;
    hideDeleteConfirm();
    await deleteRecipe(id);
  } else if (pendingDeleteEngine) {
    const eng = pendingDeleteEngine;
    hideDeleteConfirm();
    await doDeleteEngine(eng);
  }
});
document.getElementById('delete-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) hideDeleteConfirm();
});

function populateEngineDropdown(selectedValue) {
  const select = document.getElementById('f-engine');
  select.innerHTML = '';
  const engines = Object.keys(engineConfigs);
  if (engines.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Default (gemini)';
    select.appendChild(opt);
  } else {
    for (const eng of engines) {
      const opt = document.createElement('option');
      opt.value = eng;
      const cfg = engineConfigs[eng] || {};
      opt.textContent = cfg.name || capitalize(eng);
      select.appendChild(opt);
    }
    select.value = (selectedValue && engineConfigs[selectedValue]) ? selectedValue : engines[0];
  }
}

function selectRecipe(recipe, updateHighlight = true) {
  activeRecipe = recipe;
  localStorage.setItem('pa_last', recipe.id);
  if (updateHighlight) {
    document.querySelectorAll('.recipe-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === recipe.id);
    });
  }
  if (breadcrumbPage && currentView !== 'input') {
    breadcrumbPage.textContent = recipe.name || '';
  }
  if (Array.isArray(recipe.steps) && recipe.steps.length > 0) {
    const stepsSummary = recipe.steps.map((s, i) => `${i + 1}. ${escapeHtml(s.name || s.step_id)}`).join(' ➔ ');
    instructionText.innerHTML = `<strong>🔗 Pipeline (${recipe.steps.length} steps):</strong> ${stepsSummary}`;
  } else {
    const tpl = recipe.template || recipe.description || '';
    instructionText.textContent = tpl ? `"${tpl}"` : 'No instructions';
  }
  instructionText.classList.remove('ph');
  renderParams(recipe.params || []);
  updateRunState();
  updateFooterBar();
}

// ── Inline Segmented Params Bar ───────────────────────────────────────────────
function renderParams(params) {
  paramsSection.innerHTML = '';
  for (const pKey of params) {
    const cfg = PARAM_CONFIG[pKey];
    if (!cfg) continue;
    const row = document.createElement('div');
    row.className = 'param-row open';
    row.dataset.param = pKey;
    row.innerHTML = `
      <div class="param-row-header">
        <span class="param-row-label">${cfg.label}:</span>
      </div>
      <div class="param-options">
        ${cfg.options.map(o =>
          `<button type="button" class="param-opt${paramValues[pKey] === o ? ' active' : ''}" data-param="${pKey}" data-value="${o}">${capitalize(o)}</button>`
        ).join('')}
      </div>
    `;
    row.querySelectorAll('.param-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        const p = opt.dataset.param;
        const v = opt.dataset.value;
        paramValues[p] = v;
        row.querySelectorAll('.param-opt').forEach(o => o.classList.toggle('active', o.dataset.value === v));
      });
    });
    paramsSection.appendChild(row);
  }
}

function updateRunState() {
  const hasText = !!(inputArea && inputArea.value.trim());
  runBtn.disabled = !activeRecipe || !hasText;
  updateContextUI();
}

// ── Conversation state ────────────────────────────────────────────────────────
let conversationHistory = [];
let conversationEngine  = '';
let conversationSessionId = '';
let conversationTurnIndex = 0;   // 0 = initial run, 1,2,3... = follow-ups
let conversationPromptId  = '';

const followupBar   = document.getElementById('followup-bar');
const followupInput = document.getElementById('followup-input');
const followupBtn   = document.getElementById('followup-btn');

function setFollowupLoading(loading) {
  if (followupInput) followupInput.disabled = loading;
  if (followupBtn)   followupBtn.disabled   = loading;
}

// ── Pipeline Output State & Resolver ─────────────────────────────────────────
let pipelineStepOutputs = {};
let activePipelineStepId = '';

function getStepTarget(stepId, stepIndex) {
  if (stepId) {
    const box = document.getElementById(`step-box-${stepId}`) ||
                document.querySelector(`[data-step-id="${stepId}"]`);
    if (box) {
      const contentEl = box.querySelector('.step-output-content');
      if (contentEl) {
        return {
          box,
          contentEl,
          stepId: box.dataset.stepId || stepId,
        };
      }
    }
  }

  if (typeof stepIndex === 'number' && !isNaN(stepIndex)) {
    const box = document.querySelector(`[data-step-index="${stepIndex}"]`);
    if (box) {
      const contentEl = box.querySelector('.step-output-content');
      if (contentEl) {
        return {
          box,
          contentEl,
          stepId: box.dataset.stepId || `step_${stepIndex + 1}`,
        };
      }
    }
  }

  const currentBox = document.querySelector('.step-output-box.active') ||
                     document.querySelector('.step-output-box.pending') ||
                     document.querySelector('.step-output-box');
  if (currentBox) {
    const contentEl = currentBox.querySelector('.step-output-content');
    if (contentEl) {
      return {
        box: currentBox,
        contentEl,
        stepId: currentBox.dataset.stepId || 'step_1',
      };
    }
  }

  let bodyEl = document.getElementById('output-body');
  if (!bodyEl) {
    bodyEl = document.createElement('div');
    bodyEl.id = 'output-body';
    bodyEl.className = 'output-body';
    outputEl.appendChild(bodyEl);
  }
  bodyEl.style.display = 'block';
  return { box: bodyEl, contentEl: bodyEl, stepId: '' };
}

// ── Tauri events ──────────────────────────────────────────────────────────────
await listen('selection', ({ payload }) => {
  currentSelection = payload || '';
  const isRunning = runBtn.classList.contains('loading');
  if (!isRunning && !viewOutput.classList.contains('visible')) {
    showView('input');
  }
  if (currentSelection) {
    inputArea.value = currentSelection;
  }
  updateRunState();
});

await listen('status', ({ payload }) => {
  try {
    if (!payload) return;
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const stepId = data.step_id;
    const stepIndex = typeof data.step_index === 'number' ? data.step_index : undefined;

    const target = getStepTarget(stepId, stepIndex);
    if (target.box && target.box.classList.contains('step-output-box')) {
      target.box.classList.remove('pending');
      target.box.classList.add('active');
      const st = target.box.querySelector('.step-output-badge-status');
      if (st) st.innerHTML = '<span class="status-dot-pulse"></span> Running...';
    }

    if (typeof stepIndex === 'number') {
      document.querySelectorAll('.stepper-step').forEach(el => {
        if (el.dataset.stepIndex === String(stepIndex)) {
          el.classList.remove('waiting');
          el.classList.add('active');
        }
      });
    } else if (stepId) {
      document.querySelectorAll('.stepper-step').forEach(el => {
        if (el.dataset.stepId === stepId || el.id === `stepper-step-${stepId}`) {
          el.classList.remove('waiting');
          el.classList.add('active');
        }
      });
    }
  } catch (err) {
    console.error('[listen status error]:', err);
  }
});

await listen('chunk', ({ payload }) => {
  try {
    let chunkText = '';
    let stepId = '';
    let stepIndex = undefined;

    if (typeof payload === 'object' && payload !== null) {
      chunkText = payload.text || '';
      stepId = payload.step_id || '';
      stepIndex = typeof payload.step_index === 'number' ? payload.step_index : undefined;
    } else {
      chunkText = String(payload || '');
    }

    if (!chunkText) return;

    const thinking = outputEl.querySelector('.output-thinking');
    if (thinking) thinking.remove();

    aiResponseText += chunkText;

    const isChain = document.getElementById('pipeline-steps-container') !== null;

    if (isChain) {
      const target = getStepTarget(stepId, stepIndex);
      const effectiveStepId = target.stepId || (typeof stepIndex === 'number' ? `step_${stepIndex + 1}` : 'step_1');

      const current = (pipelineStepOutputs[effectiveStepId] || '') + chunkText;
      pipelineStepOutputs[effectiveStepId] = current;
      if (target.stepId) pipelineStepOutputs[target.stepId] = current;
      if (stepId) pipelineStepOutputs[stepId] = current;
      if (typeof stepIndex === 'number') {
        pipelineStepOutputs[stepIndex] = current;
        pipelineStepOutputs[`step_${stepIndex + 1}`] = current;
      }

      if (target.contentEl) {
        try {
          target.contentEl.innerHTML = renderMarkdown(current);
        } catch {
          target.contentEl.textContent = current;
        }
      }

      if (target.box && target.box.classList.contains('step-output-box')) {
        target.box.classList.remove('pending');
        target.box.classList.add('active');
        const st = target.box.querySelector('.step-output-badge-status');
        if (st && !st.innerHTML.includes('Running')) {
          st.innerHTML = '<span class="status-dot-pulse"></span> Running...';
        }

        if (target.box.dataset.stepIndex !== undefined) {
          const curIdx = parseInt(target.box.dataset.stepIndex, 10);
          const allBoxes = [...document.querySelectorAll('.step-output-box')];
          for (let i = 0; i < curIdx; i++) {
            const prevBox = allBoxes[i];
            if (prevBox) {
              prevBox.classList.remove('active', 'pending');
              prevBox.classList.add('completed');
              const pSt = prevBox.querySelector('.step-output-badge-status');
              if (pSt) pSt.innerHTML = '<span class="status-check">✓</span> Done';
              const pCopy = prevBox.querySelector('.step-copy-btn');
              if (pCopy) {
                pCopy.classList.remove('hidden');
                const pId = prevBox.dataset.stepId;
                const pIdx = i;
                pCopy.onclick = () => {
                  const pTxt = pipelineStepOutputs[pId] || pipelineStepOutputs[`step_${pIdx + 1}`] || pipelineStepOutputs[pIdx] || '';
                  writeToClipboard(pTxt);
                  pCopy.textContent = '✓ Copied';
                  setTimeout(() => { pCopy.textContent = 'Copy Step'; }, 1500);
                };
              }
              const pStepEl = document.querySelector(`.stepper-step[data-step-index="${i}"]`);
              if (pStepEl) {
                pStepEl.classList.remove('active', 'waiting');
                pStepEl.classList.add('completed');
              }
            }
          }
        }
      }
    } else {
      let bodyEl = document.getElementById('output-body');
      if (!bodyEl) {
        bodyEl = document.createElement('div');
        bodyEl.id = 'output-body';
        bodyEl.className = 'output-body';
        outputEl.appendChild(bodyEl);
      }
      bodyEl.style.display = 'block';
      try {
        bodyEl.innerHTML = renderMarkdown(aiResponseText);
      } catch {
        bodyEl.textContent = aiResponseText;
      }
    }

    outputEl.scrollTop = outputEl.scrollHeight;
  } catch (err) {
    console.error('[listen chunk error]:', err);
  }
});

await listen('error', ({ payload }) => {
  const errText = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
  const errEl = document.createElement('div');
  errEl.className = 'output-error';
  errEl.innerHTML = `<strong>Error:</strong> ${escapeHtml(errText)}`;
  const bodyEl = document.getElementById('output-body') || outputEl;
  bodyEl.appendChild(errEl);
});

await listen('done', () => {
  try {
    setRunLoading(false);
    setFollowupLoading(false);
    const thinking = outputEl.querySelector('.output-thinking');
    if (thinking) thinking.remove();

    const isChain = document.getElementById('pipeline-steps-container') !== null;

    document.querySelectorAll('.step-output-box').forEach((box, idx) => {
      box.classList.remove('active', 'pending');
      box.classList.add('completed');
      const sid = box.dataset.stepId;
      const st = box.querySelector('.step-output-badge-status');
      if (st) st.innerHTML = '<span class="status-check">✓</span> Done';

      const sText = pipelineStepOutputs[sid] || pipelineStepOutputs[`step_${idx + 1}`] || pipelineStepOutputs[idx] || '';

      const contentEl = box.querySelector('.step-output-content');
      if (contentEl && sText) {
        try {
          contentEl.innerHTML = renderMarkdown(sText);
        } catch {
          contentEl.textContent = sText;
        }
      }

      const copyBtn = box.querySelector('.step-copy-btn');
      if (copyBtn) {
        copyBtn.classList.remove('hidden');
        copyBtn.onclick = () => {
          writeToClipboard(sText);
          copyBtn.textContent = '✓ Copied';
          setTimeout(() => { copyBtn.textContent = 'Copy Step'; }, 1500);
        };
      }
    });

    document.querySelectorAll('.stepper-step').forEach(stepEl => {
      stepEl.classList.remove('active', 'waiting');
      stepEl.classList.add('completed');
    });

    if (isChain && activeRecipe && Array.isArray(activeRecipe.steps)) {
      const combined = activeRecipe.steps.map((s, idx) => {
        const sOut = (pipelineStepOutputs[s.step_id] || pipelineStepOutputs[`step_${idx + 1}`] || pipelineStepOutputs[idx] || '').trim();
        if (!sOut) return '';
        const sName = s.name || `Step ${idx + 1}`;
        return `### 📍 Step ${idx + 1}: ${sName}\n\n${sOut}`;
      }).filter(Boolean).join('\n\n---\n\n');
      if (combined) {
        aiResponseText = combined;
      }

      const container = document.getElementById('pipeline-steps-container');
      if (container && !container.querySelector('.pipeline-done-banner')) {
        const banner = document.createElement('div');
        banner.className = 'pipeline-done-banner';
        banner.innerHTML = '<span class="status-check">✓</span> All steps completed successfully';
        container.appendChild(banner);
      }
    }

    const trimmed = aiResponseText.trim();
    if (trimmed) {
      copyWrapEl.style.display = '';
      const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
      const metaEl = document.getElementById('output-meta');
      if (metaEl) metaEl.textContent = `${wordCount} words`;
      if (!isChain) {
        const bodyEl = document.getElementById('output-body');
        if (bodyEl && !bodyEl.querySelector('.output-done-badge')) {
          const badge = document.createElement('div');
          badge.className = 'output-done-badge';
          badge.textContent = 'Done';
          bodyEl.appendChild(badge);
        }
      }
      if (conversationEngine) {
        if (conversationHistory.length === 0) {
          conversationHistory.push({ role: 'user', content: currentSelection || inputArea.value.trim() });
        }
        conversationHistory.push({ role: 'assistant', content: trimmed });
        followupBar.classList.remove('hidden');
        followupInput.focus();
      }
    }
  } catch (err) {
    console.error('[listen done error]:', err);
  }
});

// ── Run / Output ──────────────────────────────────────────────────────────────

let currentSelection = '';
let aiResponseText = '';

inputArea.addEventListener('input', updateRunState);

function setRunLoading(loading) {
  const sendIcon = runBtn.querySelector('.run-icon-send');
  const loadIcon = runBtn.querySelector('.run-icon-loading');
  runBtn.disabled = loading;
  runBtn.classList.toggle('loading', loading);
  sendIcon.style.display = loading ? 'none' : '';
  loadIcon.style.display = loading ? 'flex' : 'none';
}

runBtn.addEventListener('click', async () => {
  const text = inputArea.value.trim();
  if (!activeRecipe) return;
  if (!text) {
    toggleContextDrawer(true, true);
    return;
  }

  const isChain = Array.isArray(activeRecipe.steps) && activeRecipe.steps.length > 0;
  const engine = activeRecipe.engine || Object.keys(engineConfigs)[0] || 'gemini';

  conversationHistory   = [];
  conversationEngine    = engine;
  conversationSessionId = crypto.randomUUID();
  conversationTurnIndex = 0;
  conversationPromptId  = activeRecipe.id;
  aiResponseText = '';
  pipelineStepOutputs = {};
  activePipelineStepId = isChain ? (activeRecipe.steps[0]?.step_id || '') : '';

  showView('output');
  outputEl.innerHTML = '';
  copyWrapEl.style.display = 'none';
  copyFmtMenu.classList.add('hidden');
  followupBar.classList.add('hidden');
  setRunLoading(true);

  if (isChain) {
    const stepperHtml = activeRecipe.steps.map((s, i) => `
      <div class="stepper-step ${i === 0 ? 'active' : 'waiting'}" id="stepper-step-${escapeHtml(s.step_id)}" data-step-id="${escapeHtml(s.step_id)}" data-step-index="${i}">
        <span class="stepper-num">${i + 1}</span>
        <span class="stepper-name">${escapeHtml(s.name || s.step_id)}</span>
      </div>
    `).join('<span class="stepper-arrow">➔</span>');

    const stepCardsHtml = activeRecipe.steps.map((s, i) => `
      <div class="step-output-box ${i === 0 ? 'active' : 'pending'}" id="step-box-${escapeHtml(s.step_id)}" data-step-id="${escapeHtml(s.step_id)}" data-step-index="${i}">
        <div class="step-output-header">
          <div class="step-output-header-left">
            <span class="step-output-pill">Step ${i + 1}</span>
            <span class="step-output-name">${escapeHtml(s.name || s.step_id)}</span>
          </div>
          <div class="step-output-header-right">
            <span class="step-output-badge-status" id="step-status-${escapeHtml(s.step_id)}">
              ${i === 0 ? '<span class="status-dot-pulse"></span> Running...' : 'Waiting'}
            </span>
            <button type="button" class="step-copy-btn hidden" id="step-copy-${escapeHtml(s.step_id)}" title="Copy this step output">Copy Step</button>
          </div>
        </div>
        <div class="step-output-content output-body" id="step-content-${escapeHtml(s.step_id)}">
          <div class="step-placeholder-text">${i === 0 ? 'Generating response...' : 'Waiting for previous step...'}</div>
        </div>
      </div>
    `).join('');

    outputEl.innerHTML = `
      <div class="pipeline-stepper-bar">${stepperHtml}</div>
      <div class="pipeline-steps-container" id="pipeline-steps-container">${stepCardsHtml}</div>
      <div id="output-body" style="display:none"></div>
    `;
  } else {
    outputEl.innerHTML = `<div class="output-thinking"><span class="output-engine-dot"></span>Thinking with <strong>${escapeHtml(engine)}</strong>…</div><div class="output-body" id="output-body"></div>`;
  }

  try {
    const recipeParams = activeRecipe.params || [];
    await invoke('run_recipe', {
      recipeId:   activeRecipe.id,
      selection:  text,
      engine:     engine,
      tone:       recipeParams.includes('tone')       ? paramValues.tone       : '',
      length:     recipeParams.includes('length')     ? paramValues.length     : '',
      complexity: recipeParams.includes('complexity') ? paramValues.complexity : '',
      sessionId:  conversationSessionId,
    });
  } catch (err) {
    console.error('[runBtn] Failed to invoke run_recipe:', err);
    setRunLoading(false);
    const thinking = outputEl.querySelector('.output-thinking');
    if (thinking) thinking.remove();
    const bodyEl = document.getElementById('output-body') || outputEl;
    const errEl = document.createElement('div');
    errEl.className = 'output-error';
    errEl.innerHTML = `<strong>Error executing recipe:</strong> ${escapeHtml(String(err))}`;
    bodyEl.appendChild(errEl);
  }
});

// Send follow-up message
async function sendFollowup() {
  const text = followupInput.value.trim();
  if (!text || conversationEngine === '') return;

  conversationHistory.push({ role: 'user', content: text });
  followupInput.value = '';

  const bodyEl = document.getElementById('output-body');
  if (bodyEl) {
    const hr = document.createElement('hr');
    hr.className = 'chat-divider';
    bodyEl.appendChild(hr);
    const bubble = document.createElement('div');
    bubble.className = 'chat-user-bubble';
    bubble.textContent = text;
    bodyEl.appendChild(bubble);
  }

  followupBar.classList.add('hidden');
  setFollowupLoading(true);
  aiResponseText = '';

  const thinking = document.createElement('div');
  thinking.className = 'output-thinking';
  thinking.innerHTML = `<span class="output-engine-dot"></span>Thinking with <strong>${escapeHtml(conversationEngine)}</strong>…`;
  outputEl.appendChild(thinking);
  const newBody = document.createElement('div');
  newBody.className = 'output-body';
  newBody.id = 'output-body';
  outputEl.appendChild(newBody);
  outputEl.parentElement.scrollTop = outputEl.parentElement.scrollHeight;

  conversationTurnIndex += 1;

  try {
    await invoke('send_chat', {
      messages:   conversationHistory,
      engine:     conversationEngine,
      sessionId:  conversationSessionId,
      turnIndex:  conversationTurnIndex,
      promptId:   conversationPromptId,
    });
  } catch (err) {
    thinking.remove();
    const errEl = document.createElement('div');
    errEl.className = 'output-error';
    errEl.textContent = String(err);
    newBody.appendChild(errEl);
    setFollowupLoading(false);
    followupBar.classList.remove('hidden');
  }
}

followupBtn.addEventListener('click', sendFollowup);
followupInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendFollowup();
  }
});
followupInput.addEventListener('input', () => {
  followupInput.style.height = 'auto';
  followupInput.style.height = Math.min(followupInput.scrollHeight, 80) + 'px';
});

backBtn.addEventListener('click', () => {
  conversationHistory   = [];
  conversationEngine    = '';
  conversationSessionId = '';
  conversationTurnIndex = 0;
  conversationPromptId  = '';
  followupBar.classList.add('hidden');
  showView('input');
  updateRunState();
});

async function writeToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

async function copyAs(fmt) {
  const text = aiResponseText.trim();
  if (!text) return;
  let content = text;
  if (fmt === 'html') content = renderMarkdown(text);
  if (fmt === 'with-prompt') content = `Input:\n${inputArea.value.trim()}\n\n---\n\n${text}`;
  await writeToClipboard(content);
  copyBtn.innerHTML = '✓ Copied';
  setTimeout(() => { copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="10" height="10" rx="2"/><path d="M4 12H3a2 2 0 01-2-2V3a2 2 0 012-2h7a2 2 0 012 2v1"/></svg> Copy'; }, 1800);
  copyFmtMenu.classList.add('hidden');
}

copyBtn.addEventListener('click', () => copyAs('text'));

copyFmtToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  copyFmtMenu.classList.toggle('hidden');
});

document.querySelectorAll('.copy-fmt-opt').forEach(opt => {
  opt.addEventListener('click', () => copyAs(opt.dataset.fmt));
});

document.addEventListener('click', () => copyFmtMenu.classList.add('hidden'));

// ── Recipe Type & Chain Step Builder State ─────────────────────────────────
let currentRecipeType = 'single'; // 'single' | 'chain'
let currentSteps = [];

const typeBtnSingle = document.getElementById('type-btn-single');
const typeBtnChain  = document.getElementById('type-btn-chain');
const singlePromptFields = document.getElementById('single-prompt-fields');
const chainPromptFields  = document.getElementById('chain-prompt-fields');
const addStepBtn    = document.getElementById('add-step-btn');
const stepsContainer = document.getElementById('steps-container');

function setRecipeType(type) {
  currentRecipeType = type;
  if (typeBtnSingle) typeBtnSingle.classList.toggle('active', type === 'single');
  if (typeBtnChain)  typeBtnChain.classList.toggle('active', type === 'chain');
  if (singlePromptFields) singlePromptFields.style.display = type === 'single' ? 'block' : 'none';
  if (chainPromptFields)  chainPromptFields.classList.toggle('hidden', type !== 'chain');
}

if (typeBtnSingle) typeBtnSingle.addEventListener('click', () => setRecipeType('single'));
if (typeBtnChain)  typeBtnChain.addEventListener('click', () => {
  setRecipeType('chain');
  if (currentSteps.length === 0) {
    addStep({ step_id: 'diagnose', name: 'Step 1: Phân tích lỗi', template: 'Phân tích các lỗi logic và bug trong:\n\n{{selection}}', output_key: 'diagnosis' });
    addStep({ step_id: 'fix_and_test', name: 'Step 2: Viết code fix & test', template: 'Dựa trên phân tích sau:\n\n{{diagnosis}}\n\nHãy viết code đã sửa và bộ unit tests:', output_key: 'result' });
  }
});

function addStep(stepData = {}) {
  const nextNum = currentSteps.length + 1;
  const newStep = {
    step_id: stepData.step_id || `step_${nextNum}`,
    name: stepData.name || `Step ${nextNum}`,
    template: stepData.template || (nextNum === 1 ? 'Analyze: {{selection}}' : `Process output: {{step_${nextNum - 1}_out}}`),
    provider: stepData.provider || '',
    model: stepData.model || '',
    output_key: stepData.output_key || (nextNum === 1 ? 'step_1_out' : 'result'),
  };
  currentSteps.push(newStep);
  renderStepCards();
}

function moveStep(index, delta) {
  const targetIndex = index + delta;
  if (targetIndex < 0 || targetIndex >= currentSteps.length) return;
  const temp = currentSteps[index];
  currentSteps[index] = currentSteps[targetIndex];
  currentSteps[targetIndex] = temp;
  renderStepCards();
}

function deleteStep(index) {
  if (currentSteps.length <= 1) {
    formError.textContent = 'A pipeline must have at least 1 step.';
    return;
  }
  currentSteps.splice(index, 1);
  renderStepCards();
}

function renderStepCards() {
  if (!stepsContainer) return;
  stepsContainer.innerHTML = '';

  const availableVars = ['selection'];
  currentSteps.forEach(s => {
    if (s.output_key && s.output_key !== 'result' && !availableVars.includes(s.output_key)) {
      availableVars.push(s.output_key);
    }
  });

  currentSteps.forEach((step, idx) => {
    const card = document.createElement('div');
    card.className = 'step-card';
    card.dataset.index = idx;

    const chipsHtml = availableVars
      .map(v => `<button type="button" class="step-var-chip" data-var="${v}">+ {{${v}}}</button>`)
      .join('');

    let effectiveProvider = 'gemini';
    if (step.provider) {
      if (engineConfigs[step.provider]) {
        effectiveProvider = engineConfigs[step.provider].provider || 'gemini';
      } else {
        effectiveProvider = step.provider.toLowerCase();
      }
    }
    const modelSuggestions = ENGINE_MODELS[effectiveProvider] || [];

    const configuredOptions = Object.keys(engineConfigs).map(id => {
      const cfg = engineConfigs[id] || {};
      const isSel = step.provider === id;
      return `<option value="${id}" ${isSel ? 'selected' : ''}>⚡ ${escapeHtml(cfg.name || id)} (${cfg.provider || id})</option>`;
    }).join('');

    card.innerHTML = `
      <div class="step-card-header">
        <span class="step-badge">Step ${idx + 1}</span>
        <input type="text" class="step-name-input" value="${escapeHtml(step.name || '')}" placeholder="Step name (e.g. Diagnose error)" />
        <div class="step-header-actions">
          <button type="button" class="step-icon-btn" title="Move Up" ${idx === 0 ? 'disabled style="opacity:0.3"' : ''} data-action="up">↑</button>
          <button type="button" class="step-icon-btn" title="Move Down" ${idx === currentSteps.length - 1 ? 'disabled style="opacity:0.3"' : ''} data-action="down">↓</button>
          <button type="button" class="step-icon-btn danger" title="Delete Step" data-action="delete">✕</button>
        </div>
      </div>

      <textarea class="form-input form-textarea step-template-textarea" placeholder="Prompt template for Step ${idx + 1}..."></textarea>

      <div class="step-var-chips">
        <span class="var-chip-label">Insert variable:</span>
        ${chipsHtml}
      </div>

      <div class="step-meta-row">
        <div class="step-meta-col">
          <label class="step-meta-label">Engine / Provider</label>
          <select class="step-select step-provider-select">
            <option value="" ${!step.provider ? 'selected' : ''}>Default (Inherit Recipe Engine)</option>
            ${configuredOptions ? `<optgroup label="Configured Engines">${configuredOptions}</optgroup>` : ''}
            <optgroup label="Direct Providers">
              <option value="gemini" ${step.provider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
              <option value="openai" ${step.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
              <option value="claude" ${step.provider === 'claude' ? 'selected' : ''}>Anthropic Claude</option>
              <option value="ollama" ${step.provider === 'ollama' ? 'selected' : ''}>Ollama (Local)</option>
            </optgroup>
          </select>
        </div>

        <div class="step-meta-col">
          <label class="step-meta-label">Model Override (Optional)</label>
          <input type="text" class="step-text-input step-model-input" value="${escapeHtml(step.model || '')}" placeholder="e.g. gpt-4o, gemini-2.5-pro" list="step-model-list-${idx}" autocomplete="off" />
          <datalist id="step-model-list-${idx}">
            ${modelSuggestions.map(m => `<option value="${m}">`).join('')}
          </datalist>
        </div>

        <div class="step-meta-col">
          <label class="step-meta-label">Output Key</label>
          <input type="text" class="step-text-input step-output-key" value="${escapeHtml(step.output_key || 'result')}" placeholder="e.g. diagnosis, result" />
        </div>
      </div>
    `;

    const nameInput = card.querySelector('.step-name-input');
    const textarea = card.querySelector('.step-template-textarea');
    textarea.value = step.template || '';
    const outputKeyInput = card.querySelector('.step-output-key');
    const providerSelect = card.querySelector('.step-provider-select');
    const modelInput = card.querySelector('.step-model-input');

    nameInput.addEventListener('input', (e) => { currentSteps[idx].name = e.target.value; });
    textarea.addEventListener('input', (e) => { currentSteps[idx].template = e.target.value; });
    outputKeyInput.addEventListener('input', (e) => { currentSteps[idx].output_key = e.target.value.trim(); });
    modelInput.addEventListener('input', (e) => { currentSteps[idx].model = e.target.value.trim() || null; });

    providerSelect.addEventListener('change', (e) => {
      const selected = e.target.value || null;
      currentSteps[idx].provider = selected;
      let p = 'gemini';
      if (selected) {
        if (engineConfigs[selected]) p = engineConfigs[selected].provider || 'gemini';
        else p = selected.toLowerCase();
      }
      const dl = card.querySelector(`#step-model-list-${idx}`);
      if (dl) {
        dl.innerHTML = (ENGINE_MODELS[p] || []).map(m => `<option value="${m}">`).join('');
      }
    });

    card.querySelector('[data-action="up"]')?.addEventListener('click', () => moveStep(idx, -1));
    card.querySelector('[data-action="down"]')?.addEventListener('click', () => moveStep(idx, 1));
    card.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteStep(idx));

    card.querySelectorAll('.step-var-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const v = chip.dataset.var;
        const tag = `{{${v}}}`;
        const start = textarea.selectionStart || 0;
        const end = textarea.selectionEnd || 0;
        const val = textarea.value;
        textarea.value = val.substring(0, start) + tag + val.substring(end);
        currentSteps[idx].template = textarea.value;
        textarea.focus();
        textarea.setSelectionRange(start + tag.length, start + tag.length);
      });
    });

    stepsContainer.appendChild(card);
  });
}

if (addStepBtn) {
  addStepBtn.addEventListener('click', () => addStep());
}

// ── Recipe Form (Create + Edit) ───────────────────────────────────────────────
function openCreateForm() {
  editingRecipe = null;
  formTitle.textContent = 'New Recipe';
  document.getElementById('f-name').value = '';
  document.getElementById('f-desc').value = '';
  document.getElementById('f-template').value = '';
  populateEngineDropdown('');
  document.getElementById('fc-tone').checked = false;
  document.getElementById('fc-length').checked = false;
  document.getElementById('fc-complexity').checked = false;
  currentSteps = [];
  setRecipeType('single');
  formError.textContent = '';
  formSaveBtn.disabled = false;
  formSaveBtn.textContent = 'Save Recipe';
  showView('form');
  setTimeout(() => document.getElementById('f-name')?.focus(), 20);
}

function openEditForm(recipe) {
  editingRecipe = recipe;
  formTitle.textContent = 'Edit Recipe';
  document.getElementById('f-name').value = recipe.name || '';
  document.getElementById('f-desc').value = recipe.description || '';
  document.getElementById('f-template').value = recipe.template || '';
  populateEngineDropdown(recipe.engine || '');
  const params = recipe.params || [];
  document.getElementById('fc-tone').checked = params.includes('tone');
  document.getElementById('fc-length').checked = params.includes('length');
  document.getElementById('fc-complexity').checked = params.includes('complexity');

  if (Array.isArray(recipe.steps) && recipe.steps.length > 0) {
    currentSteps = JSON.parse(JSON.stringify(recipe.steps));
    setRecipeType('chain');
    renderStepCards();
  } else {
    currentSteps = [];
    setRecipeType('single');
  }

  formError.textContent = '';
  formSaveBtn.disabled = false;
  formSaveBtn.textContent = 'Save Changes';
  showView('form');
}

addRecipeBtn.addEventListener('click', openCreateForm);
formCancelBtn.addEventListener('click', () => showView('input'));

formSaveBtn.addEventListener('click', async () => {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { formError.textContent = 'Name is required'; return; }

  let template = '';
  let stepsJson = null;

  if (currentRecipeType === 'chain') {
    if (currentSteps.length === 0) {
      formError.textContent = 'A pipeline must have at least 1 step.';
      return;
    }
    for (let i = 0; i < currentSteps.length; i++) {
      if (!currentSteps[i].template || !currentSteps[i].template.trim()) {
        formError.textContent = `Step ${i + 1} template cannot be empty.`;
        return;
      }
    }
    stepsJson = JSON.stringify(currentSteps);
    template = currentSteps[0].template;
  } else {
    template = document.getElementById('f-template').value.trim();
    if (!template) { formError.textContent = 'Template is required'; return; }
  }

  formError.textContent = '';
  formSaveBtn.disabled = true;
  formSaveBtn.textContent = 'Saving…';

  const description   = document.getElementById('f-desc').value.trim();
  const engine        = document.getElementById('f-engine').value;
  const checkedParams = ['tone', 'length', 'complexity']
    .filter(k => document.getElementById(`fc-${k}`).checked)
    .join(',');

  try {
    if (editingRecipe) {
      await invoke('update_recipe', {
        id: editingRecipe.id, name, description, template, engine,
        params: checkedParams, icon: editingRecipe.icon || '', steps: stepsJson,
      });
    } else {
      const id = slugify(name) || `recipe_${Date.now()}`;
      await invoke('save_recipe', {
        id, name, description, template, engine,
        params: checkedParams, icon: '', steps: stepsJson,
      });
    }
    await loadRecipes();
    showView('input');
  } catch (err) {
    formError.textContent = String(err);
  } finally {
    formSaveBtn.disabled = false;
    formSaveBtn.textContent = editingRecipe ? 'Save Changes' : 'Save Recipe';
  }
});

// ── Window drag ───────────────────────────────────────────────────────────────
function makeDraggable(el) {
  if (!el) return;
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, input, textarea, select, a, kbd')) return;
    if (e.button !== 0) return;
    try {
      _tauri?.window?.getCurrentWindow?.()?.startDragging?.();
    } catch (_) {}
  });
}
makeDraggable(document.getElementById('header'));

// ── Close & Global Keyboard-First Navigation (look / Raycast UX) ─────────────
closeBtn.addEventListener('click', () => {
  invoke('hide_window').catch(() => window.close());
});

let isRecording = false; // hotkey recording state declared before keydown listener

document.addEventListener('keydown', e => {
  // Let hotkey recorder handle its own key events when active
  if (isRecording) return;

  const isMeta = e.metaKey || e.ctrlKey;
  const deleteModal = document.getElementById('delete-modal');
  const isModalOpen = deleteModal && deleteModal.classList.contains('visible');

  // 1. Hierarchical Escape handling
  if (e.key === 'Escape') {
    e.preventDefault();
    if (isModalOpen) {
      hideDeleteConfirm();
      return;
    }
    if (currentView !== 'input') {
      showView('input');
      return;
    }
    if (isContextDrawerOpen) {
      toggleContextDrawer(false, false);
      return;
    }
    if (cmdSearchInput && cmdSearchInput.value.trim() !== '') {
      cmdSearchInput.value = '';
      filterPaletteItems('');
      cmdSearchInput.focus();
      return;
    }
    invoke('hide_window').catch(() => window.close());
    return;
  }

  // 2. Global shortcuts (⌘N, ⌘Y, ⌘,, ⌘K, ⌘D, ⌘E)
  if (isMeta && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    openCreateForm();
    return;
  }
  if (isMeta && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    showView('history');
    loadHistory();
    return;
  }
  if (isMeta && e.key === ',') {
    e.preventDefault();
    openSettingsView();
    return;
  }
  if (isMeta && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (currentView !== 'input') showView('input');
    cmdSearchInput?.focus();
    cmdSearchInput?.select();
    return;
  }
  if (isMeta && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    applyDark(document.documentElement.dataset.dark !== 'true');
    return;
  }
  if (isMeta && e.key.toLowerCase() === 't') {
    e.preventDefault();
    openSettingsView().then(() => switchSettingsTab('appearance'));
    return;
  }
  if (isMeta && e.key.toLowerCase() === 'e' && currentView === 'input' && activeRecipe) {
    e.preventDefault();
    openEditForm(activeRecipe);
    return;
  }

  // 3. Launcher ('input') view Keyboard-First Navigation
  if (currentView === 'input' && !isModalOpen) {
    const inTextarea = document.activeElement === inputArea;

    // Tab toggles Context Drawer
    if (e.key === 'Tab' && !e.shiftKey && !isMeta) {
      e.preventDefault();
      if (!isContextDrawerOpen) {
        toggleContextDrawer(true, true);
      } else if (inTextarea) {
        toggleContextDrawer(false, false);
      } else {
        inputArea?.focus();
      }
      return;
    }

    // Arrow Down / Up navigates recipes & quick actions (unless moving cursor inside multi-line textarea)
    if (e.key === 'ArrowDown' && (!inTextarea || e.altKey)) {
      e.preventDefault();
      movePaletteSelection(1);
      return;
    }
    if (e.key === 'ArrowUp' && (!inTextarea || e.altKey)) {
      e.preventDefault();
      movePaletteSelection(-1);
      return;
    }

    // Enter executes the highlighted command or recipe
    if (e.key === 'Enter') {
      if (inTextarea) {
        // Inside textarea: Cmd+Enter or Enter (without Shift) runs the recipe
        if (isMeta || !e.shiftKey) {
          e.preventDefault();
          if (!runBtn.disabled) runBtn.click();
        }
        return;
      }
      if (!e.shiftKey) {
        e.preventDefault();
        triggerSelectedPaletteItem();
        return;
      }
    }
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────
const engineListEl     = document.getElementById('engine-list');
const addEngineBtn     = document.getElementById('add-engine-btn');
const engineForm       = document.getElementById('engine-form');
const engineFormTitle  = document.getElementById('engine-form-title');
const engineFormCancel = document.getElementById('engine-form-cancel');
const engineFormSave   = document.getElementById('engine-form-save');
const engineFormErr    = document.getElementById('engine-form-err');
const efId       = document.getElementById('ef-id');
const efProvider = document.getElementById('ef-provider');
const efName     = document.getElementById('ef-name');
const efKey      = document.getElementById('ef-key');
const efModel    = document.getElementById('ef-model');

let editingEngine = null;

function updateModelDatalist(engineId) {
  const dl = document.getElementById('engine-model-list');
  dl.innerHTML = '';
  const models = ENGINE_MODELS[engineId] || [];
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m;
    dl.appendChild(opt);
  }
}

async function loadEngineConfigs() {
  try {
    const raw = await invoke('get_engine_configs');
    const arr = JSON.parse(raw);
    engineConfigs = {};
    if (Array.isArray(arr)) {
      for (const item of arr) {
        engineConfigs[item.id] = {
          provider: item.provider,
          name: item.name,
          api_key: item.api_key,
          model: item.model,
        };
      }
    }
  } catch {
    engineConfigs = {};
  }
  renderEngineList();
  updateFooterBar();
}

function renderEngineList() {
  engineListEl.innerHTML = '';
  const engines = Object.keys(engineConfigs);
  if (engines.length === 0) {
    engineListEl.innerHTML = '<p class="settings-empty">No engines configured yet.</p>';
    return;
  }
  for (const eng of engines) {
    const cfg = engineConfigs[eng] || {};
    const key = cfg.api_key || '';
    const model = cfg.model || '';
    const displayName = cfg.name || eng;
    const hasKey = key !== '' || cfg.provider === 'ollama';
    const card = document.createElement('div');
    card.className = 'engine-card';
    card.innerHTML = `
      <div class="engine-header">
        <span class="engine-dot"></span>
        <span class="engine-name">${escapeHtml(displayName)}</span>
        <span class="engine-id-badge">${escapeHtml(eng)}</span>
        ${cfg.provider ? `<span class="engine-provider-badge">${escapeHtml(cfg.provider)}</span>` : ''}
        <span class="engine-status ${hasKey ? 'configured' : 'empty'}">${hasKey ? 'Configured' : 'Not set'}</span>
        <div class="engine-card-actions">
          <button class="engine-edit-btn" data-engine="${escapeHtml(eng)}" title="Edit">Edit</button>
          <button class="engine-del-btn" data-engine="${escapeHtml(eng)}" title="Delete">✕</button>
        </div>
      </div>
      <div class="engine-info">
        <span class="engine-info-row"><span class="engine-info-label">Key:</span> ${key.startsWith('env:') ? `<code>${escapeHtml(key)}</code>` : (key ? '••••••••' : (cfg.provider === 'ollama' ? 'Local' : '—'))}</span>
        <span class="engine-info-row"><span class="engine-info-label">Model:</span> ${escapeHtml(model || '—')}</span>
      </div>
    `;
    card.querySelector('.engine-edit-btn').addEventListener('click', () => openEngineForm(eng));
    card.querySelector('.engine-del-btn').addEventListener('click', () => deleteEngine(eng));
    engineListEl.appendChild(card);
  }
}

const ENGINE_KEY_PLACEHOLDERS = {
  gemini: 'AIza... or env:GEMINI_API_KEY',
  claude: 'sk-ant-... or env:ANTHROPIC_API_KEY',
  openai: 'sk-... or env:OPENAI_API_KEY',
  ollama: 'Optional for local Ollama',
};

function applyEngineFormDefaults(provider) {
  updateModelDatalist(provider);
  efKey.placeholder = ENGINE_KEY_PLACEHOLDERS[provider] || 'api-key';
}

function openEngineForm(engId = null) {
  editingEngine = engId;
  engineFormTitle.textContent = engId ? `Edit — ${engId}` : 'New Engine';

  efId.value    = engId || '';
  efId.disabled = !!engId;

  const cfg = engId ? (engineConfigs[engId] || {}) : {};
  const key = cfg.api_key || '';
  const provider = cfg.provider || 'gemini';

  efProvider.value = provider;
  efProvider.disabled = !!engId;
  efName.value  = cfg.name  || '';
  efKey.value   = key.startsWith('env:') ? '' : key;
  efModel.value = cfg.model || '';

  applyEngineFormDefaults(provider);
  if (key.startsWith('env:')) efKey.placeholder = key;

  engineFormErr.textContent = '';
  engineForm.classList.remove('hidden');
  efId.disabled ? efKey.focus() : efId.focus();
}

function closeEngineForm() {
  engineForm.classList.add('hidden');
  editingEngine = null;
  efId.value = '';
  efProvider.value = 'gemini';
  efName.value = '';
  efKey.value = '';
  efModel.value = '';
}

function deleteEngine(eng) {
  pendingDeleteEngine = eng;
  document.getElementById('delete-modal-name').textContent = `engine "${eng}"`;
  document.getElementById('delete-modal').classList.add('visible');
}

async function doDeleteEngine(eng) {
  settingsMsg.textContent = '';
  try {
    await invoke('delete_engine_config', { engine: eng });
    await loadEngineConfigs();
    settingsMsg.textContent = `✓ Engine "${eng}" deleted`;
    settingsMsg.className = 'settings-msg';
    setTimeout(() => { settingsMsg.textContent = ''; }, 2500);
  } catch (err) {
    settingsMsg.textContent = String(err);
    settingsMsg.className = 'settings-msg error';
  }
}

addEngineBtn.addEventListener('click', () => openEngineForm(null));
engineFormCancel.addEventListener('click', closeEngineForm);
efProvider.addEventListener('change', () => applyEngineFormDefaults(efProvider.value));

engineFormSave.addEventListener('click', async () => {
  const id       = editingEngine || efId.value.trim().toLowerCase().replace(/\s+/g, '-');
  const provider = editingEngine
    ? (engineConfigs[editingEngine]?.provider || efProvider.value)
    : efProvider.value;
  const name  = efName.value.trim();
  const key   = efKey.value.trim();
  const model = efModel.value.trim();

  if (!id) {
    engineFormErr.textContent = 'ID is required (e.g. gemini-flash).';
    return;
  }

  if (!editingEngine && engineConfigs[id]) {
    engineFormErr.textContent = `ID "${id}" already exists. Choose a different ID.`;
    return;
  }

  engineFormSave.disabled = true;
  engineFormSave.textContent = 'Saving…';
  engineFormErr.textContent = '';
  settingsMsg.textContent = '';

  try {
    await invoke('save_engine_config', { engine: id, provider, apiKey: key, model, name });
    await loadEngineConfigs();
    closeEngineForm();
    settingsMsg.textContent = `✓ Engine "${id}" saved`;
    settingsMsg.className = 'settings-msg';
    setTimeout(() => { settingsMsg.textContent = ''; }, 2500);
  } catch (err) {
    engineFormErr.textContent = String(err);
  } finally {
    engineFormSave.disabled = false;
    engineFormSave.textContent = 'Save';
  }
});

// ── Hotkey recorder ───────────────────────────────────────────────────────────
const hotkeyDisplayText   = document.getElementById('hotkey-display-text');
const hotkeyRecordBtn     = document.getElementById('hotkey-record-btn');
const hotkeyRecordingHint = document.getElementById('hotkey-recording-hint');
const hotkeyMsg           = document.getElementById('hotkey-msg');

async function loadHotkey() {
  try {
    const hk = await invoke('get_hotkey_cmd');
    hotkeyDisplayText.textContent = hk || 'Alt+Space';
  } catch {
    hotkeyDisplayText.textContent = 'Alt+Space';
  }
}

function startRecording() {
  isRecording = true;
  hotkeyRecordBtn.textContent = 'Cancel';
  hotkeyRecordBtn.classList.add('recording');
  hotkeyRecordingHint.classList.remove('hidden');
  hotkeyDisplayText.textContent = '…';
}

function stopRecording() {
  isRecording = false;
  hotkeyRecordBtn.textContent = 'Change';
  hotkeyRecordBtn.classList.remove('recording');
  hotkeyRecordingHint.classList.add('hidden');
}

hotkeyRecordBtn.addEventListener('click', () => {
  if (isRecording) {
    stopRecording();
    loadHotkey();
  } else {
    startRecording();
  }
});

document.addEventListener('keydown', async (e) => {
  if (!isRecording) return;
  e.preventDefault();

  if (e.key === 'Escape') {
    stopRecording();
    loadHotkey();
    return;
  }

  const mods = [];
  if (e.ctrlKey)  mods.push('Ctrl');
  if (e.altKey)   mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey)  mods.push('Super');

  const modKeys = new Set(['Control','Alt','Shift','Meta']);
  if (modKeys.has(e.key)) return;
  if (mods.length === 0) return;

  const key = e.code.startsWith('Key')   ? e.code.slice(3)
            : e.code.startsWith('Digit') ? e.code.slice(5)
            : e.code === 'Space'         ? 'Space'
            : e.key;

  const hotkey = [...mods, key].join('+');
  hotkeyDisplayText.textContent = hotkey;
  stopRecording();

  hotkeyMsg.textContent = '';
  try {
    await invoke('set_hotkey', { hotkey });
    hotkeyMsg.textContent = `✓ Hotkey saved: ${hotkey}`;
    hotkeyMsg.className = 'settings-msg';
    setTimeout(() => { hotkeyMsg.textContent = ''; }, 2500);
  } catch (err) {
    hotkeyMsg.textContent = String(err);
    hotkeyMsg.className = 'settings-msg error';
    loadHotkey();
  }
});

// ── Appearance: Ghostty Theme, Opacity & Custom Wallpaper ─────────────────────
const VALID_THEMES = ['ghostty-default', 'catppuccin', 'tokyo-night', 'rose-pine', 'dracula', 'nord'];
const bgLayerEl        = document.getElementById('app-bg-layer');
const opacitySlider    = document.getElementById('opacity-slider');
const opacityValLabel  = document.getElementById('opacity-val-label');
const bgBlurSlider     = document.getElementById('bg-blur-slider');
const bgBlurValLabel   = document.getElementById('bg-blur-val-label');
const bgFileInput      = document.getElementById('bg-file-input');
const bgUploadBtn      = document.getElementById('bg-upload-btn');
const bgUrlInput       = document.getElementById('bg-url-input');
const bgUrlApplyBtn    = document.getElementById('bg-url-apply-btn');
const bgClearBtn       = document.getElementById('bg-clear-btn');

function applyTheme(name) {
  const validName = VALID_THEMES.includes(name) ? name : 'ghostty-default';
  document.documentElement.dataset.theme = validName;
  document.querySelectorAll('.theme-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.theme === validName);
  });
  localStorage.setItem('ghostty_theme', validName);
}

function applyDark(dark) {
  document.documentElement.dataset.dark = dark ? 'true' : 'false';
  const btn = document.getElementById('dark-toggle');
  if (btn) btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  localStorage.setItem('ghostty_dark', dark ? 'true' : 'false');
}

function applyOpacity(val) {
  let num = parseFloat(val);
  if (isNaN(num)) num = 0.88;
  // Accept either percentage (0..100) or float (0..1.0)
  if (num > 1) num = num / 100;
  num = Math.min(1, Math.max(0, num));

  const pct = Math.round(num * 100);
  document.documentElement.style.setProperty('--app-opacity', num.toFixed(2));
  // Scale backdrop blur with opacity so at 0% there's no frosted glass
  const blurPx = Math.round(28 * num);
  const sat = Math.round(100 + 90 * num);
  document.body.style.backdropFilter = `blur(${blurPx}px) saturate(${sat}%)`;
  document.body.style.webkitBackdropFilter = `blur(${blurPx}px) saturate(${sat}%)`;
  // Toggle native macOS vibrancy: disable below 15% for true transparency
  invoke('set_vibrancy', { enabled: num >= 0.15 }).catch(() => {});
  if (opacitySlider) opacitySlider.value = String(pct);
  if (opacityValLabel) opacityValLabel.textContent = `${pct}%`;
  localStorage.setItem('ghostty_opacity', num.toFixed(2));
}

function applyBgBlur(px) {
  let num = parseInt(px, 10);
  if (isNaN(num)) num = 8;
  num = Math.min(32, Math.max(0, num));

  document.documentElement.style.setProperty('--bg-image-blur', `${num}px`);
  if (bgBlurSlider) bgBlurSlider.value = String(num);
  if (bgBlurValLabel) bgBlurValLabel.textContent = `${num}px`;
  localStorage.setItem('pa_bg_blur', String(num));
}

function applyBackground(source) {
  const src = (source || 'none').trim();
  if (!bgLayerEl) return;

  // Reset state
  bgLayerEl.style.backgroundImage = '';
  delete bgLayerEl.dataset.preset;
  bgLayerEl.classList.remove('has-bg');

  let activePreset = 'none';

  if (!src || src === 'none') {
    localStorage.removeItem('pa_bg_source');
    if (bgUrlInput) bgUrlInput.value = '';
    if (bgClearBtn) bgClearBtn.classList.add('hidden');
  } else if (src.startsWith('preset:')) {
    activePreset = src.slice('preset:'.length);
    bgLayerEl.dataset.preset = activePreset;
    localStorage.setItem('pa_bg_source', src);
    if (bgUrlInput) bgUrlInput.value = '';
    if (bgClearBtn) bgClearBtn.classList.remove('hidden');
  } else {
    // Custom URL or Data URL
    activePreset = '';
    const safeUrl = src.replace(/"/g, '\\"');
    bgLayerEl.style.backgroundImage = `url("${safeUrl}")`;
    bgLayerEl.classList.add('has-bg');
    try {
      localStorage.setItem('pa_bg_source', src);
    } catch (e) {
      console.warn('Wallpaper too large for localStorage:', e);
    }
    if (bgUrlInput && !src.startsWith('data:')) {
      bgUrlInput.value = src;
    }
    if (bgClearBtn) bgClearBtn.classList.remove('hidden');
  }

  document.querySelectorAll('.bg-preset-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.bgPreset === activePreset);
  });

  // If user activates a wallpaper while opacity is very high (>= 0.90), gently lower to 0.78 so wallpaper is visible
  if (src && src !== 'none') {
    const curOp = parseFloat(localStorage.getItem('pa_opacity') || '0.92');
    if (curOp >= 0.90) {
      applyOpacity(0.78);
    }
  }
}

function compressImageFileToDataUrl(file, maxWidth = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.querySelectorAll('.theme-swatch').forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});

// Dark toggle removed — always dark mode
const darkToggleEl = document.getElementById('dark-toggle');
if (darkToggleEl) {
  darkToggleEl.addEventListener('click', () => {
    applyDark(document.documentElement.dataset.dark !== 'true');
  });
}

if (opacitySlider) {
  opacitySlider.addEventListener('input', (e) => applyOpacity(e.target.value));
}
if (bgBlurSlider) {
  bgBlurSlider.addEventListener('input', (e) => applyBgBlur(e.target.value));
}

if (bgUploadBtn && bgFileInput) {
  bgUploadBtn.addEventListener('click', () => bgFileInput.click());
  bgFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      applyBackground(dataUrl);
    } catch (err) {
      console.error('Failed to load background image:', err);
    }
    bgFileInput.value = '';
  });
}

if (bgUrlApplyBtn && bgUrlInput) {
  const applyUrlFn = () => {
    const url = bgUrlInput.value.trim();
    if (url) applyBackground(url);
  };
  bgUrlApplyBtn.addEventListener('click', applyUrlFn);
  bgUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyUrlFn();
    }
  });
}

if (bgClearBtn) {
  bgClearBtn.addEventListener('click', () => applyBackground('none'));
}

document.querySelectorAll('.bg-preset-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const preset = chip.dataset.bgPreset;
    if (!preset || preset === 'none') {
      applyBackground('none');
    } else {
      applyBackground(`preset:${preset}`);
    }
  });
});

// Initialize Appearance from localStorage — always dark
applyDark(true);
applyTheme(localStorage.getItem('ghostty_theme') || 'ghostty-default');
applyOpacity(localStorage.getItem('ghostty_opacity') || '0.88');
applyBgBlur(localStorage.getItem('pa_bg_blur') || '12');
applyBackground(localStorage.getItem('pa_bg_source') || 'none');

// ── Settings tabs ─────────────────────────────────────────────────────────────
function switchSettingsTab(tabName) {
  document.querySelectorAll('.settings-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.settings-tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `settings-tab-${tabName}`);
  });
  if (tabName === 'hotkeys') loadHotkey();
}

document.querySelectorAll('.settings-tab').forEach(btn => {
  btn.addEventListener('click', () => switchSettingsTab(btn.dataset.tab));
});

async function openSettingsView() {
  await loadEngineConfigs();
  closeEngineForm();
  settingsMsg.textContent = '';
  settingsMsg.className = 'settings-msg';
  switchSettingsTab('engines');
  showView('settings');
}

if (settingsBtn) {
  settingsBtn.addEventListener('click', openSettingsView);
}
settingsCloseBtn.addEventListener('click', () => showView('input'));

// ── Backup/Restore ────────────────────────────────────────────────────────────
let selectedImportFile = null;

async function exportBackup() {
  const exportBtn = document.getElementById('backup-export-btn');
  const msgEl = document.getElementById('backup-msg');
  msgEl.textContent = '';
  msgEl.className = 'settings-msg';

  try {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting...';

    const jsonContent = await invoke('export_data');

    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);

    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute('download', `promptly_backup_${dateStr}.json`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    msgEl.textContent = '✓ Export successful!';
    msgEl.className = 'settings-msg';
  } catch (err) {
    console.error(err);
    msgEl.textContent = `❌ Export failed: ${err}`;
    msgEl.className = 'settings-msg error';
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = 'Export to JSON';
  }
}

function setupBackupTab() {
  const importFileEl = document.getElementById('backup-import-file');
  const importBtn = document.getElementById('backup-import-btn');
  const submitBtn = document.getElementById('backup-import-submit-btn');
  const fileNameSpan = document.getElementById('import-file-name');
  const exportBtn = document.getElementById('backup-export-btn');
  const msgEl = document.getElementById('backup-msg');

  exportBtn.addEventListener('click', exportBackup);
  importBtn.addEventListener('click', () => importFileEl.click());

  importFileEl.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      selectedImportFile = file;
      fileNameSpan.textContent = file.name;
      submitBtn.disabled = false;
      msgEl.textContent = '';
    } else {
      selectedImportFile = null;
      fileNameSpan.textContent = 'No file selected';
      submitBtn.disabled = true;
    }
  });

  submitBtn.addEventListener('click', async () => {
    if (!selectedImportFile) return;

    msgEl.textContent = '';
    msgEl.className = 'settings-msg';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Importing...';

    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target.result;
      try {
        const response = await invoke('import_data', { jsonContent: content });
        msgEl.textContent = response || '✓ Import successful!';
        msgEl.className = 'settings-msg';

        await loadRecipes();
        await loadEngineConfigs();

        importFileEl.value = '';
        selectedImportFile = null;
        fileNameSpan.textContent = 'No file selected';
      } catch (err) {
        console.error(err);
        msgEl.textContent = `❌ Import failed: ${err}`;
        msgEl.className = 'settings-msg error';
        submitBtn.disabled = false;
      } finally {
        submitBtn.textContent = 'Import Data';
      }
    };
    reader.onerror = () => {
      msgEl.textContent = '❌ Failed to read selected file';
      msgEl.className = 'settings-msg error';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Import Data';
    };
    reader.readAsText(selectedImportFile);
  });
}

// ── History ───────────────────────────────────────────────────────────────────
const historyBtn      = document.getElementById('history-btn');
const historyCloseBtn = document.getElementById('history-close-btn');
const historyClearBtn = document.getElementById('history-clear-btn');
const historyListEl   = document.getElementById('history-list');

function formatTimeAgo(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function buildHistoryTurnEl(r, label) {
  const responseText = (r.response     || '').trim();
  const finalPrompt  = (r.final_prompt || '').trim();
  const preview      = responseText.slice(0, 100).replace(/\n+/g, ' ') || '(no response)';

  const safeRecipeId = escapeHtml(r.prompt_id || '—');
  const safeEngine   = escapeHtml(r.engine    || '');
  const safeTime     = escapeHtml(formatTimeAgo(r.created_at));
  const safeLabel    = label ? escapeHtml(label) : '';

  const el = document.createElement('div');
  el.className = 'history-item';

  const header = document.createElement('div');
  header.className = 'history-item-header';
  header.innerHTML = `
    <span class="history-recipe">${safeRecipeId}</span>
    ${safeLabel ? `<span class="history-turn-badge">${safeLabel}</span>` : ''}
    <span class="history-engine">${safeEngine}</span>
    <span class="history-time">${safeTime}</span>
  `;

  const previewEl = document.createElement('div');
  previewEl.className = 'history-preview';
  previewEl.textContent = preview;

  const detail = document.createElement('div');
  detail.className = 'history-detail';

  if (finalPrompt) {
    const inputLabel = document.createElement('div');
    inputLabel.className = 'history-input-label';
    inputLabel.textContent = 'Prompt sent';

    const inputText = document.createElement('div');
    inputText.className = 'history-input-text';
    inputText.textContent = finalPrompt;

    detail.appendChild(inputLabel);
    detail.appendChild(inputText);
  }

  const responseHeader = document.createElement('div');
  responseHeader.className = 'history-response-header';

  const responseLabel = document.createElement('span');
  responseLabel.className = 'history-response-label';
  responseLabel.textContent = 'Response';
  responseHeader.appendChild(responseLabel);

  let copyBtn = null;
  if (responseText) {
    copyBtn = document.createElement('button');
    copyBtn.className = 'history-copy-btn';
    copyBtn.title = 'Copy response';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await writeToClipboard(responseText);
      copyBtn.textContent = '✓ Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1800);
    });
    responseHeader.appendChild(copyBtn);
  }

  const responseText_el = document.createElement('div');
  responseText_el.className = 'history-response-text';
  let hasRenderedMarkdown = false;

  if (!responseText) {
    responseText_el.innerHTML = '<em>(empty)</em>';
    hasRenderedMarkdown = true;
  }

  detail.appendChild(responseHeader);
  detail.appendChild(responseText_el);

  el.appendChild(header);
  el.appendChild(previewEl);
  el.appendChild(detail);

  el.addEventListener('click', (e) => {
    const targetNode = e.target;
    if (targetNode && typeof targetNode.closest === 'function' && targetNode.closest('.history-detail')) return;

    const willExpand = !el.classList.contains('expanded');
    if (willExpand && !hasRenderedMarkdown && responseText) {
      responseText_el.innerHTML = renderMarkdown(responseText);
      hasRenderedMarkdown = true;
    }

    el.classList.toggle('expanded');
  });

  return el;
}

function invokeWithTimeout(cmd, args, ms = 8000) {
  return Promise.race([
    invoke(cmd, args),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Command '${cmd}' timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function loadHistory() {
  historyListEl.innerHTML = '<p class="history-empty">Loading…</p>';
  try {
    const json = await invokeWithTimeout('list_history', {}, 8000);
    const records = JSON.parse(json) || [];

    if (records.length === 0) {
      historyListEl.innerHTML = '<p class="history-empty">No history yet.</p>';
      return;
    }
    historyListEl.innerHTML = '';

    const sessions = new Map();
    for (const r of records) {
      const sid = r.session_id || '';
      if (!sid) continue;
      if (!sessions.has(sid)) sessions.set(sid, []);
      sessions.get(sid).push(r);
    }
    for (const turns of sessions.values()) {
      turns.sort((a, b) => (a.turn_index || 0) - (b.turn_index || 0));
    }

    const renderQueue = [];
    const seenSessions = new Set();
    for (const r of records) {
      const sid = r.session_id || '';
      if (!sid) {
        renderQueue.push({ type: 'solo', record: r });
        continue;
      }
      if (seenSessions.has(sid)) continue;
      seenSessions.add(sid);
      const turns = sessions.get(sid);
      if (turns.length === 1) {
        renderQueue.push({ type: 'solo', record: turns[0] });
      } else {
        renderQueue.push({ type: 'thread', turns });
      }
    }

    const BATCH = 5;
    let idx = 0;
    function renderBatch() {
      const end = Math.min(idx + BATCH, renderQueue.length);
      for (; idx < end; idx++) {
        const item = renderQueue[idx];
        if (item.type === 'solo') {
          historyListEl.appendChild(buildHistoryTurnEl(item.record, null));
        } else {
          const { turns } = item;
          const thread = document.createElement('div');
          thread.className = 'history-thread';
          const threadHeader = document.createElement('div');
          threadHeader.className = 'history-thread-header';
          threadHeader.innerHTML = `
            <span class="history-thread-icon">💬</span>
            <span class="history-thread-label">${escapeHtml(turns[0].prompt_id || 'Conversation')}</span>
            <span class="history-thread-count">${turns.length} turns</span>
            <span class="history-thread-time">${escapeHtml(formatTimeAgo(turns[0].created_at))}</span>
            <span class="history-thread-caret">›</span>
          `;
          const threadBody = document.createElement('div');
          threadBody.className = 'history-thread-body';
          for (const turn of turns) {
            const label = turn.turn_index === 0 ? 'Initial' : `Follow-up ${turn.turn_index}`;
            const turnEl = buildHistoryTurnEl(turn, label);
            turnEl.classList.add('history-thread-turn');
            threadBody.appendChild(turnEl);
          }
          threadHeader.addEventListener('click', () => thread.classList.toggle('expanded'));
          thread.appendChild(threadHeader);
          thread.appendChild(threadBody);
          historyListEl.appendChild(thread);
        }
      }
      if (idx < renderQueue.length) {
        setTimeout(renderBatch, 0);
      }
    }
    renderBatch();

  } catch (err) {
    historyListEl.innerHTML = `<p class="history-empty">Error: ${err.message || err}</p>`;
  }
}

historyBtn.addEventListener('click', async () => {
  showView('history');
  loadHistory();
});

historyCloseBtn.addEventListener('click', () => showView('input'));

let clearConfirmPending = false;
let clearConfirmTimer = null;

historyClearBtn.addEventListener('click', async () => {
  if (!clearConfirmPending) {
    clearConfirmPending = true;
    historyClearBtn.textContent = 'Sure?';
    clearConfirmTimer = setTimeout(() => {
      clearConfirmPending = false;
      historyClearBtn.textContent = 'Clear All';
    }, 3000);
    return;
  }
  clearTimeout(clearConfirmTimer);
  clearConfirmPending = false;
  historyClearBtn.textContent = 'Clear All';
  try {
    await invoke('clear_history');
    await loadHistory();
  } catch (err) {
    historyListEl.innerHTML = `<p class="history-empty">Error: ${err}</p>`;
  }
});

listen('open-history', () => {
  showView('history');
  loadHistory();
});

// ── Init ──────────────────────────────────────────────────────────────────────
showView('input');
loadRecipes();
loadEngineConfigs();
setupBackupTab();
updateContextUI();

// Load clipboard on startup
invoke('get_clipboard').then(clip => {
  if (clip) {
    currentSelection = clip;
    inputArea.value = clip;
    updateRunState();
  }
}).catch(() => {});
