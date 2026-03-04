// ===== Supabase helpers =====
const sb = () => window.supabaseClient;

// (no app público não precisa exigir login)
async function requireLogin(){
  const { data: { session } } = await sb().auth.getSession();
  if(!session){
    window.location.href = "login.html";
    return false;
  }
  return true;
}

async function isAdmin(){
  const { data: { user } } = await sb().auth.getUser();
  if(!user) return false;

  const { data, error } = await sb()
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if(error) return false;
  return !!data;
}

// ===== Favoritos (local) =====
const FAV_KEY = "martreeAcademy.favs.v2";
const $ = (id) => document.getElementById(id);

function toast(msg){
  const el = $("toast");
  if(!el) return;
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(window.__t);
  window.__t = setTimeout(()=> el.style.display="none", 2200);
}

function safeParse(s, fallback){ try{ return JSON.parse(s);}catch{ return fallback; } }
function getFavs(){ return new Set(safeParse(localStorage.getItem(FAV_KEY), [])); }
function setFavs(set){ localStorage.setItem(FAV_KEY, JSON.stringify([...set])); }

function normalize(s){
  return String(s||"").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"");
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function truncate(s,n=120){
  s = String(s||"");
  return s.length<=n ? s : s.slice(0,n-1)+"…";
}

function uniqueCats(videos){
  const set = new Set(videos.map(v => (v.category||"").trim()).filter(Boolean));
  return [...set].sort((a,b)=>a.localeCompare(b));
}

function fmtDate(ts){
  if(!ts) return "";
  const d = new Date(ts);
  if(Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

/* ====== URL helpers: YouTube/Vimeo/MP4 ====== */
function parseSource(url){
  const u = String(url||"").trim();

  if(/\.(mp4)(\?.*)?$/i.test(u)) return {platform:"mp4", id:null};

  const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{6,})/);
  if(yt?.[1]) return {platform:"youtube", id: yt[1]};

  const vm = u.match(/vimeo\.com\/(\d+)/);
  if(vm?.[1]) return {platform:"vimeo", id: vm[1]};

  if(u.includes("youtube.com/embed/")){
    const m = u.match(/embed\/([A-Za-z0-9_-]{6,})/);
    return {platform:"youtube", id: m?.[1] || null};
  }
  if(u.includes("player.vimeo.com/video/")){
    const m = u.match(/video\/(\d+)/);
    return {platform:"vimeo", id: m?.[1] || null};
  }

  return {platform:"unknown", id:null};
}

function buildEmbed(url){
  const s = parseSource(url);
  if(s.platform==="mp4") return {type:"mp4", src:url};
  if(s.platform==="youtube" && s.id) return {type:"iframe", src:`https://www.youtube.com/embed/${s.id}`};
  if(s.platform==="vimeo" && s.id) return {type:"iframe", src:`https://player.vimeo.com/video/${s.id}`};
  return {type:"iframe", src:url};
}

function defaultThumb(url){
  const s = parseSource(url);
  if(s.platform==="youtube" && s.id){
    return `https://img.youtube.com/vi/${s.id}/hqdefault.jpg`;
  }
  return "";
}

function placeholderThumb(){
  return "data:image/svg+xml;utf8," + encodeURIComponent(`
  <svg xmlns='http://www.w3.org/2000/svg' width='1280' height='720'>
    <defs>
      <linearGradient id='g' x1='0' x2='1'>
        <stop offset='0' stop-color='rgba(125,211,252,0.25)'/>
        <stop offset='1' stop-color='rgba(167,243,208,0.18)'/>
      </linearGradient>
    </defs>
    <rect width='100%' height='100%' fill='rgba(255,255,255,0.06)'/>
    <rect width='100%' height='100%' fill='url(#g)'/>
    <text x='50%' y='50%' font-size='46' fill='rgba(255,255,255,0.78)' text-anchor='middle' font-family='Arial'>Martree Academy</text>
  </svg>`);
}

// ====== Banco: listar vídeos ======
async function fetchVideos(){
  const { data, error } = await sb()
    .from("videos")
    .select("id,url,title,category,thumb,description,tags,created_at")
    .order("created_at", { ascending:false });

  if(error) throw error;
  return data || [];
}

// cache em memória
let allCache = [];
let onlyFavs = false;

function renderStats(all){
  const cats = uniqueCats(all);
  $("sVideos").textContent = String(all.length);
  $("sCats").textContent = String(cats.length);
  $("sFavs").textContent = String(getFavs().size);
}

async function render(){
  let all = [];
  try{
    all = await fetchVideos();
  }catch(err){
    console.error(err);
    toast("Erro ao carregar vídeos do banco");
    all = [];
  }

  allCache = all;
  const favs = getFavs();

  const cats = ["Todas as categorias", ...uniqueCats(all)];
  const sel = $("cat");
  const keep = sel.value || "Todas as categorias";
  sel.innerHTML = cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  sel.value = cats.includes(keep) ? keep : "Todas as categorias";

  const q = normalize($("q").value);
  const cat = sel.value;

  let list = all.slice();

  if(onlyFavs) list = list.filter(v => favs.has(v.id));
  if(cat !== "Todas as categorias") list = list.filter(v => (v.category||"").trim() === cat);

  if(q){
    list = list.filter(v=>{
      const blob = normalize([v.title, v.category, v.description, (v.tags||[]).join(",")].join(" "));
      return blob.includes(q);
    });
  }

  renderStats(all);
  $("resultInfo").textContent = `${list.length} resultado(s)`;

  const grid = $("grid");
  grid.innerHTML = "";

  if(list.length === 0){
    $("empty").hidden = false;
    return;
  }
  $("empty").hidden = true;

  list.forEach(v=>{
    const card = document.createElement("article");
    card.className = "videoCard";
    card.tabIndex = 0;

    const tags = (v.tags||[]).slice(0,4).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join("");
    const th = v.thumb || defaultThumb(v.url) || placeholderThumb();

    card.innerHTML = `
      <div class="thumb">
        <img src="${escapeHtml(th)}" alt="">
        <div class="play"><div class="playBadge">▶</div></div>
      </div>

      <div class="vBody">
        <div class="vTop">
          <h4 class="vTitle">${escapeHtml(v.title||"Sem título")}</h4>
          <span class="badge">${escapeHtml(v.category||"Sem categoria")}</span>
        </div>

        <p class="vDesc">${escapeHtml(truncate(v.description || "Sem descrição."))}</p>

        <div class="tagRow">${tags}</div>

        <div class="vFoot">
          <button class="fav ${favs.has(v.id) ? "active":""}" type="button" data-fav="${escapeHtml(v.id)}">
            ${favs.has(v.id) ? "★ Favorito" : "☆ Favoritar"}
          </button>
          <span class="muted" style="font-size:12px">${fmtDate(v.created_at)}</span>
        </div>
      </div>
    `;

    card.addEventListener("click",(e)=>{
      const favBtn = e.target.closest("[data-fav]");
      if(favBtn) return;
      openModal(v.id);
    });

    card.addEventListener("keydown",(e)=>{
      if(e.key==="Enter" || e.key===" "){
        e.preventDefault();
        openModal(v.id);
      }
    });

    card.querySelector("[data-fav]")?.addEventListener("click",(e)=>{
      e.stopPropagation();
      toggleFav(v.id);
      render();
      toast("Atualizado nos favoritos");
    });

    grid.appendChild(card);
  });
}

function toggleFav(id){
  const favs = getFavs();
  favs.has(id) ? favs.delete(id) : favs.add(id);
  setFavs(favs);
}

function openModal(id){
  const v = allCache.find(x=>x.id===id);
  if(!v) return;

  $("mTitle").textContent = v.title || "Vídeo";
  $("mMeta").textContent = `${v.category||"Sem categoria"} • ${(v.tags||[]).join(", ") || "sem tags"}`;
  $("mDesc").textContent = v.description || "";

  const embed = buildEmbed(v.url);
  const player = $("player");
  player.innerHTML = "";

  if(embed.type==="mp4"){
    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.src = embed.src;
    player.appendChild(video);
  }else{
    const iframe = document.createElement("iframe");
    iframe.src = embed.src;
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    player.appendChild(iframe);
  }

  const favs = getFavs();
  $("mFav").textContent = favs.has(id) ? "Remover favorito" : "Favoritar";
  $("mFav").onclick = ()=>{
    toggleFav(id);
    $("mFav").textContent = getFavs().has(id) ? "Remover favorito" : "Favoritar";
    renderStats(allCache);
    toast("Favoritos atualizados");
  };

  $("mOpen").href = v.url;
  showModal(true);
}

function showModal(show){
  const m = $("modal");
  if(show){
    m.classList.add("show");
    m.setAttribute("aria-hidden","false");
    document.body.style.overflow="hidden";
  }else{
    $("player").innerHTML = "";
    m.classList.remove("show");
    m.setAttribute("aria-hidden","true");
    document.body.style.overflow="";
  }
}

function wire(){
  $("q").addEventListener("input", ()=> render());
  $("cat").addEventListener("change", ()=> render());

  $("btnFavs").addEventListener("click", ()=>{
    onlyFavs = !onlyFavs;
    $("btnFavs").textContent = onlyFavs ? "Ver todos" : "Favoritos";
    render();
  });

  $("btnReset").addEventListener("click", ()=>{
    onlyFavs = false;
    $("btnFavs").textContent = "Favoritos";
    $("q").value = "";
    $("cat").value = "Todas as categorias";
    render();
  });

  $("mClose").addEventListener("click", ()=>showModal(false));
  $("mBack").addEventListener("click", ()=>showModal(false));
  document.addEventListener("keydown",(e)=>{
    if(e.key==="Escape" && $("modal").classList.contains("show")) showModal(false);
  });
}

(function init(){
  wire();
  render();
})();
