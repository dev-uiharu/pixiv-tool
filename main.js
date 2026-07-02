// config.js
class Config {
  constructor() {
    this.minPageCount = 30;
    this.excludeAI = false;
    this.excludeTags = [
      "ロリ",
      "loli",
      "ふたなり",
      "男の娘",
      "ショタ",
      "ホモ",
      "ゲイ",
      "BL",
      "アヘ顔"
    ];
  }
}

// search-query.js
class SearchQuery {
  constructor({
    word,
    page = 1,
    order = "date_d",
    mode = "r18",
    aiType = 0,
    csw = 0,
    sMode = "s_tag_tc",
    ratio = "",
    lang = "ja"
  }) {
    this.word = word;
    this.page = page;
    this.order = order;
    this.mode = mode;
    this.aiType = aiType;
    this.csw = csw;
    this.sMode = sMode;
    this.ratio = ratio;
    this.lang = lang;
  }
  static fromLocation() {
    const url = new URL(location.href);
    const tagMatch = url.pathname.match(/^\/tags\/([^/]+)(?:\/artworks)?\/?$/);
    const isTagSearch = Boolean(tagMatch);
    const rawSMode = url.searchParams.get("s_mode") ?? "tag_tc";
    const sMode = isTagSearch
      ? "s_tag_full"
      : (rawSMode.startsWith("s_") ? rawSMode : `s_${rawSMode}`);
    const word = isTagSearch
      ? decodeURIComponent(tagMatch[1])
      : (url.searchParams.get("q") ?? "");
    return new SearchQuery({
      word,
      page: Number(url.searchParams.get("p") ?? 1),
      order: url.searchParams.get("order") ?? "date_d",
      mode: url.searchParams.get("mode") ?? "r18",
      aiType: Number(url.searchParams.get("ai_type") ?? 0),
      csw: Number(url.searchParams.get("csw") ?? 0),
      sMode,
      ratio: url.searchParams.get("ratio") ?? "",
      lang: url.searchParams.get("lang") ?? "ja"
    });
  }
  clone(values = {}) {
    return new SearchQuery({
      ...this,
      ...values
    });
  }
}

// pixiv-client.js
class PixivClient {
  createUrl(query) {
    const url = new URL(`https://www.pixiv.net/ajax/search/artworks/${encodeURIComponent(query.word)}`);
    url.searchParams.set("order", query.order);
    url.searchParams.set("mode", query.mode);
    url.searchParams.set("p", query.page);
    url.searchParams.set("ai_type", query.aiType);
    url.searchParams.set("csw", query.csw);
    url.searchParams.set("s_mode", query.sMode || "s_tag_tc");
    url.searchParams.set("ratio", query.ratio);
    url.searchParams.set("lang", query.lang);
    return url;
  }
  normalizeWork(item) {
    return {
      id: item.id,
      title: item.title,
      imageUrl: item.url,
      pageCount: item.pageCount,
      width: item.width,
      height: item.height,
      tags: item.tags,
      userId: item.userId,
      userName: item.userName,
      aiType: item.aiType,
      xRestrict: item.xRestrict,
      restrict: item.restrict,
      illustType: item.illustType,
      createDate: item.createDate,
      updateDate: item.updateDate,
      profileImageUrl: item.profileImageUrl,
      isOriginal: item.isOriginal,
      description: item.description,
      alt: item.alt,
      isAd: item.isAdContainer === true
    };
  }
  async search(query) {
    const response = await fetch(this.createUrl(query), {
      credentials: "same-origin"
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const json = await response.json();
    if (json.error) {
      throw new Error(json.message);
    }
    const body = json.body?.illustManga;
    if (!body) {
      throw new Error("Invalid response.");
    }
    return {
      page: query.page,
      total: body.total,
      lastPage: body.lastPage,
      hasNext: query.page < body.lastPage,
      works: body.data
        .filter(item => !item.isAdContainer)
        .map(item => this.normalizeWork(item))
    };
  }
}

// filter.js
class Filter {
  constructor(config) {
    this.config = config;
  }
  apply(works) {
    return works.filter(work => this.accept(work));
  }
  accept(work) {
    return this.ad(work)
      && this.ai(work)
      && this.pageCount(work)
      && this.tags(work);
  }
  ad(work) {
    return !work.isAd;
  }
  ai(work) {
    if (!this.config.excludeAI) return true;
    return work.aiType !== 2;
  }
  pageCount(work) {
    return work.pageCount >= this.config.minPageCount;
  }
  tags(work) {
    // console.log(work.tags);
    if (this.config.excludeTags.length === 0) return true;
    return !work.tags.some(tag => this.config.excludeTags.includes(tag));
  }
}

// pixiv-dom.js
class PixivDom {
  getGrid() {
    return document.querySelector("div.m-0.p-0.gap-0.grid.grid-cols-3.grid-flow-dense");
  }
  getTemplate(grid) {
    const template = grid.firstElementChild?.cloneNode(true);
    if (!template) {
      throw new Error("Template not found.");
    }
    return template;
  }
  getLink(node) {
    return node.querySelector("a");
  }
  getImage(node) {
    return node.querySelector("img");
  }
  getImageContainer(node) {
    // return node.querySelector(".gutbuO");
    return node.querySelector("img")?.closest("div");
  }
  getPagination() {
    return [...document.querySelectorAll("nav")]
      .find(nav => nav.querySelector("[aria-current='true']"));
  }
  removePageCount(node) {
    node.querySelector(".sc-e414e6ba-16")?.remove();
  }
  removeAiLabel(node) {
    // node.querySelector(".sc-e414e6ba-15")?.remove();
  }
  removeBadge(node) {
    node.querySelector(".sc-e414e6ba-9")?.remove();
  }
  removeAds() {
    document.querySelectorAll('[id^="adsdk"]')
      .forEach(el => el.remove());
    document.querySelectorAll('[class^="mb-16"]')
      .forEach(el => el.remove());

  }
  startAdGuard() {
    this.removeAds();
    const observer = new MutationObserver(() => {
      this.removeAds();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    return observer;
  }
}

// renderer.js
class Renderer {
  constructor(dom) {
    this.dom = dom;
    this.grid = dom.getGrid();
    this.template = dom.getTemplate(this.grid);
  }
  clear() {
    this.grid.replaceChildren();
  }
  create(work) {
    const node = this.template.cloneNode(true);
    this.updateLink(node, work);
    this.updateImage(node, work);
    this.cleanup(node);
    this.addPageCount(node, work.pageCount);
    return node;
  }
  updateLink(node, work) {
    node.dataset.ga4EntityId = `illust/${work.id}`;
    const link = this.dom.getLink(node);
    if (!link) return;
    link.href = `/artworks/${work.id}`;
    link.dataset.gtmValue = work.id;
  }
  updateImage(node, work) {
    const img = this.dom.getImage(node);
    if (!img) return;
    img.src = work.imageUrl;
    img.alt = work.alt;
  }
  cleanup(node) {
    this.dom.removeAiLabel(node);
    this.dom.removePageCount(node);
    this.dom.removeBadge(node);
  }
  addPageCount(node, pageCount) {
    const container = this.dom.getImageContainer(node);
    if (!container) return;
    let overlay = container.querySelector(".pe-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "pe-overlay";
      container.appendChild(overlay);
    }
    const page = document.createElement("div");
    page.className = "pe-page";
    page.textContent = pageCount;
    overlay.appendChild(page);
  }
  append(work) {
    this.grid.appendChild(this.create(work));
  }
  appendAll(works) {
    const fragment = document.createDocumentFragment();
    works.forEach(work => {
      fragment.appendChild(this.create(work));
    });
    this.grid.appendChild(fragment);
  }
  getLoadingElement() {
    let el = document.querySelector(".pe-loading");
    if (!el) {
      el = document.createElement("div");
      el.className = "pe-loading";
      el.hidden = true;
      el.textContent = "⏳ 次ページを読み込み中...";
      // const reference = document.querySelector(".pe-progress") || document.body;
      // reference.appendChild(el);
      const progress = document.querySelector(".pe-progress");
      const anchor = progress || this.dom.getPagination() || document.body;
      if (progress) {
        progress.before(el);
      } else if (anchor.before) {
        anchor.before(el);
      } else {
        anchor.appendChild(el);
      }
    }
    return el;
  }
  getProgressElement() {
    let el = document.querySelector(".pe-progress");
    if (!el) {
      el = document.createElement("div");
      el.className = "pe-progress";
      // this.dom.getPagination()?.before(el);
      const loading = document.querySelector(".pe-loading");
      const anchor = loading || this.dom.getPagination() || document.body;
      if (loading) {
        loading.after(el);
      } else if (anchor.before) {
        anchor.before(el);
      } else {
        anchor.appendChild(el);
      }
    }
    return el;
  }
  showLoading() {
    this.getLoadingElement().hidden = false;
  }
  hideLoading() {
    this.getLoadingElement().hidden = true;
  }
  updateProgress(current, last) {
    this.getProgressElement().textContent =
      `${current} / ${last} ページ読込済み`;
  }
}

// pager.js
class Pager {
  constructor(query, client, filter, renderer, dom) {
    this.baseQuery = query;
    this.client = client;
    this.filter = filter;
    this.renderer = renderer;
    this.dom = dom;
    this.currentPage = query.page - 1;
    this.lastPage = Infinity;
    this.loading = false;
    this.loadedIds = new Set();
    this.pagination = null;
    this.scrollHandler = null;
    this.ticking = false;
  }
  init() {
    this.pagination = this.dom.getPagination();
  }
  createQuery(page) {
    return this.baseQuery.clone({ page });
  }
  async load(page) {
    const result = await this.client.search(this.createQuery(page));
    this.lastPage = result.lastPage;
    const works = this.filter.apply(result.works).filter(work => {
      if (this.loadedIds.has(work.id)) return false;
      this.loadedIds.add(work.id);
      return true;
    });
    this.renderer.appendAll(works);
    this.currentPage = page;
    this.renderer.updateProgress(
      this.currentPage,
      this.lastPage
    );
    // ページネーションを再取得（SPA対策）
    this.pagination = this.dom.getPagination();
    // 描画後もページネーションが見えているなら続けて取得
    this.handleScroll();
    console.log(`Page ${page}: ${works.length}/${result.works.length}`);
  }
  async loadCurrent() {
    this.renderer.clear();
    this.loadedIds.clear();
    this.currentPage = this.baseQuery.page - 1;
    this.lastPage = Infinity;
    await this.load(this.currentPage + 1);
  }
  async loadNext() {
    if (this.loading) return;
    if (this.currentPage >= this.lastPage) return;
    this.loading = true;
    this.renderer.showLoading();
    try {
      await this.load(this.currentPage + 1);
    } catch (e) {
      console.error(e);
    } finally {
      this.renderer.hideLoading();
      this.loading = false;
    }
  }
  handleScroll() {
    if (this.loading) return;
    if (this.currentPage >= this.lastPage) return;
    if (!this.pagination) {
      this.pagination = this.dom.getPagination();
      if (!this.pagination) return;
    }
    const rect = this.pagination.getBoundingClientRect();
    // ページネーションが画面内に入ったら次ページ取得
    if (rect.top <= window.innerHeight && rect.bottom >= 0) {
      this.loadNext();
    }
  }
  start() {
    this.scrollHandler = () => {
      if (this.ticking) return;
      this.ticking = true;
      requestAnimationFrame(() => {
        this.ticking = false;
        this.handleScroll();
      });
    };
    window.addEventListener("scroll", this.scrollHandler, {
      passive: true
    });
    // 初回も判定
    this.handleScroll();
  }
}

// main.js
function injectStyle() {
  if (document.getElementById("pe-style")) return;
  const style = document.createElement("style");
  style.id = "pe-style";
  style.textContent = `
.pe-overlay{
position:absolute;
top:4px;
right:4px;
display:flex;
flex-direction:column;
align-items:flex-end;
gap:2px;
z-index:999;
pointer-events:none;
}
.pe-page{
padding:2px 6px;
background:rgba(0,0,0,.8);
color:#fff;
font-size:12px;
font-weight:bold;
line-height:1;
border-radius:4px;
}
.pe-loading,
.pe-progress{
margin:12px 0;
text-align:center;
font-size:14px;
color:#666;
}
.pe-loading{
font-weight:bold;
}`;
  document.head.appendChild(style);
}
(async () => {
  injectStyle();
  const config = new Config();
  const dom = new PixivDom();
  const query = SearchQuery.fromLocation();
  const client = new PixivClient();
  const filter = new Filter(config);
  const renderer = new Renderer(dom);
  const pager = new Pager(query, client, filter, renderer, dom);
  dom.startAdGuard();
  pager.init();
  await pager.loadCurrent();
  pager.start();
  window.pixiv = {
    config,
    query,
    client,
    filter,
    renderer,
    pager
  };
})();
