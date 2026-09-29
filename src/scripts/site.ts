let pageController: AbortController | undefined;
let toastTimer: ReturnType<typeof setTimeout>;

function notify(message: string) {
  const toast = document.querySelector<HTMLElement>('.toast');
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2500);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function setup() {
  pageController?.abort();
  pageController = new AbortController();
  const { signal } = pageController;

  const toggle = document.querySelector<HTMLButtonElement>('.theme-toggle');
  const updateThemeLabel = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    toggle?.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#181e19' : '#eeede6');
  };
  updateThemeLabel();
  toggle?.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('zonkor-theme', theme); } catch { /* Theme still works if storage is unavailable. */ }
    updateThemeLabel();
  }, { signal });

  const search = document.querySelector<HTMLInputElement>('#article-search');
  const filterButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.filter-button'));
  const entries = Array.from(document.querySelectorAll<HTMLElement>('.archive-entry'));
  let category = 'All';
  if (search) {
    const query = new URL(location.href).searchParams.get('q');
    if (query) search.value = query;
    const filter = () => {
      const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let visible = 0;
      entries.forEach((entry) => {
        const matchesCategory = category === 'All' || entry.dataset.postCategory === category;
        const matchesSearch = terms.every((term) => (entry.dataset.search ?? '').includes(term));
        entry.hidden = !(matchesCategory && matchesSearch);
        if (!entry.hidden) visible++;
      });
      const count = document.querySelector('#results-count');
      if (count) count.textContent = `${visible} ${visible === 1 ? 'ENTRY' : 'ENTRIES'}`;
      const empty = document.querySelector<HTMLElement>('#no-results');
      if (empty) empty.hidden = visible > 0;
      filterButtons.forEach((button) => {
        const selected = button.dataset.category === category;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
    };
    filterButtons.forEach((button) => button.addEventListener('click', () => {
      category = button.dataset.category ?? 'All';
      filter();
    }, { signal }));
    search.addEventListener('input', filter, { signal });
    document.querySelector('#reset-search')?.addEventListener('click', () => {
      search.value = '';
      category = 'All';
      const url = new URL(location.href);
      url.searchParams.delete('q');
      history.replaceState({}, '', url);
      filter();
      search.focus();
    }, { signal });
    document.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !target?.closest('input, textarea, [contenteditable]')) {
        event.preventDefault();
        search.focus();
      }
      if (event.key === 'Escape' && document.activeElement === search) {
        search.value = '';
        filter();
        search.blur();
      }
    }, { signal });
    filter();
  }

  document.querySelector<HTMLButtonElement>('.share-button')?.addEventListener('click', async () => {
    const url = new URL(location.href);
    url.hash = '';
    notify(await copyText(url.href) ? 'LINK COPIED TO CLIPBOARD' : 'COPY THE URL FROM YOUR ADDRESS BAR');
  }, { signal });

  document.querySelectorAll<HTMLPreElement>('.prose pre').forEach((pre) => {
    if (pre.querySelector('.copy-code')) return;
    const button = document.createElement('button');
    button.className = 'copy-code';
    button.type = 'button';
    button.textContent = 'COPY';
    button.setAttribute('aria-label', 'Copy code block');
    button.addEventListener('click', async () => {
      const code = pre.querySelector('code')?.textContent ?? '';
      const success = await copyText(code);
      button.textContent = success ? 'COPIED' : 'RETRY';
      notify(success ? 'CODE COPIED TO CLIPBOARD' : 'COULD NOT COPY CODE');
      setTimeout(() => { button.textContent = 'COPY'; }, 2000);
    }, { signal });
    pre.appendChild(button);
  });

  const article = document.querySelector<HTMLElement>('#article-body');
  const progress = document.querySelector<HTMLElement>('#reading-progress-bar');
  if (article && progress) {
    const headings = Array.from(article.querySelectorAll<HTMLElement>('h2, h3'));
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.article-toc ol a'));
    let ticking = false;
    const updateReading = () => {
      const rect = article.getBoundingClientRect();
      const start = rect.top + scrollY - 80;
      const end = Math.max(start + 1, rect.bottom + scrollY - innerHeight * .6);
      const percentage = Math.min(1, Math.max(0, (scrollY - start) / (end - start)));
      progress.style.transform = `scaleX(${percentage})`;
      let current = headings[0]?.id;
      headings.forEach((heading) => { if (heading.getBoundingClientRect().top <= 160) current = heading.id; });
      links.forEach((link) => {
        const active = link.hash === `#${current}`;
        link.classList.toggle('current', active);
        if (active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) { requestAnimationFrame(updateReading); ticking = true; }
    };
    document.addEventListener('scroll', onScroll, { passive: true, signal });
    window.addEventListener('resize', onScroll, { passive: true, signal });
    updateReading();
  }
}

document.addEventListener('astro:before-swap', (event) => {
  event.newDocument.documentElement.dataset.theme = document.documentElement.dataset.theme;
  event.newDocument.documentElement.classList.add('js');
});
document.addEventListener('astro:page-load', setup);
