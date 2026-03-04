// ===== Supabase helpers =====
const sb = () => window.supabaseClient;

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

async function requireAdmin(){
  const ok = await requireLogin();
  if(!ok) return false;

  const okAdmin = await isAdmin();
  if(!okAdmin){
    alert("Sem permissão de admin.");
    window.location.href = "index.html";
    return false;
  }
  return true;
}

// ===== UI Helpers =====
const $ = (id) => document.getElementById(id);

function bind(id, evt, fn){
  const el = $(id);
  if(!el){
    console.warn(`[admin.js] Elemento #${id} não encontrado no admin.html`);
    return;
  }
  el.addEventListener(evt, fn);
}

function toast(msg){
  const el = $("toast");
  if(!el) return;
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(window.__t);
  window.__t = setTimeout(()=> el.style.display="none", 2200);
}

function normalize(s){
  return String(s||"").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"");
}

function parseTags(s){
  return String(s||"").split(",").map(t=>t.trim()).filter(Boolean).slice(0,14);
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function uid(){
  if(window.crypto?.randomUUID) return crypto.randomUUID();
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

/* ====== URL helpers ====== */
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

function defaultThumb(url){
  const s = parseSource(url);
  if(s.platform==="youtube" && s.id){
    return `https://img.youtube.com/vi/${s.id}/hqdefault.jpg`;
  }
  return "";
}

async function importFromLink(url){
  const src = parseSource(url);

  if(src.platform==="youtube"){
    const o = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    if(!o.ok) throw new Error("Falha ao importar do YouTube");
    const data = await o.json();
    return { title: data.title || "", thumb: data.thumbnail_url || defaultThumb(url) };
  }

  if(src.platform==="vimeo"){
    const o = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`);
    if(!o.ok) throw new Error("Falha ao importar do Vimeo");
    const data = await o.json();
    return { title: data.title || "", thumb: data.thumbnail_url || "" };
  }

  return { title:"", thumb: defaultThumb(url) || "" };
}

// ====== Banco: CRUD ======
async function fetchVideosAdmin(){
  const { data, error } = await sb()
    .from("videos")
    .select("id,url,title,category,thumb,description,tags,created_at,created_by")
    .order("created_at", { ascending:false });

  if(error) throw error;
  return data || [];
}

async function createVideo(payload){
  const { data: { user } } = await sb().auth.getUser();

  const row = {
    id: payload.id || uid(),
    url: payload.url,
    title: payload.title,
    category: payload.category,
    thumb: payload.thumb || "",
    description: payload.description || "",
    tags: payload.tags || [],
  };

  // Só seta created_by se existir user (e se sua tabela tiver essa coluna)
  if(user?.id) row.created_by = user.id;

  const { error } = await sb().from("videos").insert([row]);
  if(error) throw error;
}

async function updateVideo(id, payload){
  const { error } = await sb().from("videos").update({
    url: payload.url,
    title: payload.title,
    category: payload.category,
    thumb: payload.thumb || "",
    description: payload.description || "",
    tags: payload.tags || [],
  }).eq("id", id);

  if(error) throw error;
}

async function deleteVideo(id){
  const { error } = await sb().from("videos").delete().eq("id", id);
  if(error) throw error;
}

// ====== Import/Export JSON (Banco) ======
function downloadJson(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportJson(){
  const videos = await fetchVideosAdmin();
  // exporta só campos úteis
  const clean = videos.map(v => ({
    id: v.id,
    url: v.url,
    title: v.title,
    category: v.category,
    thumb: v.thumb || "",
    description: v.description || "",
    tags: Array.isArray(v.tags) ? v.tags : [],
    created_at: v.created_at || null
  }));
  downloadJson("martree-academy-videos.json", clean);
  toast("JSON exportado");
}

async function importJsonFile(file){
  const text = await file.text();
  const parsed = JSON.parse(text);
  if(!Array.isArray(parsed)) throw new Error("JSON inválido: esperado um array");

  // insere um por um (simples e confiável)
  for(const item of parsed){
    const payload = {
      id: item.id || uid(),
      url: String(item.url || "").trim(),
      title: String(item.title || "").trim(),
      category: String(item.category || "").trim(),
      thumb: String(item.thumb || "").trim(),
      description: String(item.description || "").trim(),
      tags: Array.isArray(item.tags) ? item.tags.map(String) : []
    };

    if(!payload.url || !payload.title || !payload.category){
      // pula itens ruins
      continue;
    }

    // tenta upsert: se existir id, atualiza; se não, cria
    // (isso exige que "id" seja PK/unique)
    const { error } = await sb().from("videos").upsert([payload], { onConflict: "id" });
    if(error) throw error;
  }
}

// ====== Form ======
function clearForm(){
  $("id") && ($("id").value = "");
  $("url") && ($("url").value = "");
  $("title") && ($("title").value = "");
  $("category") && ($("category").value = "");
  $("thumb") && ($("thumb").value = "");
  $("description") && ($("description").value = "");
  $("tags") && ($("tags").value = "");
  $("btnSave") && ($("btnSave").textContent = "Salvar");
}

function fillForm(v){
  $("id").value = v.id;
  $("url").value = v.url || "";
  $("title").value = v.title || "";
  $("category").value = v.category || "";
  if($("thumb")) $("thumb").value = v.thumb || "";
  $("description").value = v.description || "";
  $("tags").value = (Array.isArray(v.tags) ? v.tags : []).join(", ");
  $("btnSave").textContent = "Atualizar";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

let cacheAdmin = [];

async function render(){
  let videos = [];
  try{
    videos = await fetchVideosAdmin();
  }catch(err){
    console.error(err);
    toast("Erro ao carregar vídeos do banco");
    videos = [];
  }

  cacheAdmin = videos;

  const qEl = $("q");
  const q = qEl ? normalize(qEl.value) : "";
  let list = videos.slice();

  if(q){
    list = list.filter(v=>{
      const blob = normalize([v.title, v.category, v.description, (v.tags||[]).join(",")].join(" "));
      return blob.includes(q);
    });
  }

  const grid = $("grid");
  const empty = $("empty");
  if(!grid) return;

  grid.innerHTML = "";

  if(list.length===0){
    if(empty) empty.hidden = false;
    return;
  }
  if(empty) empty.hidden = true;

  list.forEach(v=>{
    const th = (v.thumb || defaultThumb(v.url) || "").trim();
    const card = document.createElement("article");
    card.className = "videoCard";
    card.style.cursor = "default";
    card.innerHTML = `
      <div class="thumb">
        ${th ? `<img src="${escapeHtml(th)}" alt="">` : ""}
        <div class="play"><div class="playBadge">🛠</div></div>
      </div>
      <div class="vBody">
        <div class="vTop">
          <h4 class="vTitle">${escapeHtml(v.title||"Sem título")}</h4>
          <span class="badge">${escapeHtml(v.category||"Sem categoria")}</span>
        </div>
        <p class="vDesc">${escapeHtml((v.description||"Sem descrição.").slice(0,120))}${(v.description||"").length>120?"…":""}</p>
        <div class="tagRow">${(v.tags||[]).slice(0,4).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
        <div class="vFoot">
          <button class="btn ghost" type="button" data-edit="${escapeHtml(v.id)}">Editar</button>
          <button class="btn danger" type="button" data-del="${escapeHtml(v.id)}">Excluir</button>
        </div>
      </div>
    `;

    card.querySelector("[data-edit]")?.addEventListener("click", ()=> fillForm(v));

    card.querySelector("[data-del]")?.addEventListener("click", async ()=>{
      const ok = confirm(`Excluir "${v.title}"?`);
      if(!ok) return;
      try{
        await deleteVideo(v.id);
        await render();
        toast("Vídeo removido");
      }catch(err){
        console.error(err);
        alert("Erro ao excluir.\n\n" + (err?.message || err));
      }
    });

    grid.appendChild(card);
  });
}

async function seed(){
  const has = cacheAdmin.length > 0;
  if(has){
    const ok = confirm("Já existem vídeos cadastrados. SOBRESCREVER com exemplos?");
    if(!ok) return;
    for(const v of cacheAdmin){
      await deleteVideo(v.id);
    }
  }

  try{
    await createVideo({
      id: uid(),
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Padrão de atendimento (base)",
      category: "Atendimento",
      thumb: "",
      description: "Boas práticas de abordagem, postura e finalização com o cliente.",
      tags: ["atendimento","padrão","cliente"]
    });

    await render();
    toast("Exemplos carregados");
  }catch(err){
    console.error(err);
    alert("Erro ao carregar exemplos.\n\n" + (err?.message || err));
  }
}

/* ====== Wiring ====== */
function wire(){
  bind("q","input", ()=> render());
  bind("btnReset","click", clearForm);

  bind("btnSeed","click", async ()=> seed());

  bind("btnClearAll","click", async ()=>{
    const ok = confirm("Apagar TODOS os vídeos?");
    if(!ok) return;

    try{
      for(const v of cacheAdmin){
        await deleteVideo(v.id);
      }
      clearForm();
      await render();
      toast("Tudo apagado");
    }catch(err){
      console.error(err);
      alert("Erro ao apagar tudo.\n\n" + (err?.message || err));
    }
  });

  bind("btnImport","click", async ()=>{
    const urlEl = $("url");
    if(!urlEl) return;
    const url = urlEl.value.trim();
    if(!url){ alert("Cole o link do vídeo primeiro."); return; }

    const btn = $("btnImport");
    if(btn){ btn.disabled = true; btn.textContent = "Importando..."; }

    try{
      const data = await importFromLink(url);
      if(data.title && $("title") && !$("title").value.trim()) $("title").value = data.title;
      const th = data.thumb || defaultThumb(url);
      if(th && $("thumb") && !$("thumb").value.trim()) $("thumb").value = th;
      toast("Importado do link");
    }catch(err){
      alert("Não consegui importar automaticamente.\n\n" + err.message);
    }finally{
      if(btn){ btn.disabled = false; btn.textContent = "Importar do link"; }
    }
  });

  // ✅ Exportar JSON (do banco)
  bind("btnExport","click", async ()=>{
    try{ await exportJson(); }
    catch(err){ console.error(err); alert("Erro ao exportar.\n\n" + (err?.message || err)); }
  });

  // ✅ Importar JSON (para o banco)
  bind("importFile","change", async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    const ok = confirm("Importar este JSON para o banco? (vai atualizar pelo id)");
    if(!ok) return;

    try{
      await importJsonFile(file);
      await render();
      toast("JSON importado");
    }catch(err){
      console.error(err);
      alert("Erro ao importar.\n\n" + (err?.message || err));
    }finally{
      e.target.value = "";
    }
  });

  bind("form","submit", async (e)=>{
    e.preventDefault();

    const id = ($("id")?.value || "").trim();
    const url = ($("url")?.value || "").trim();
    const title = ($("title")?.value || "").trim();
    const category = ($("category")?.value || "").trim();
    const thumb = ($("thumb")?.value || "").trim() || defaultThumb(url);
    const description = ($("description")?.value || "").trim();
    const tags = parseTags(($("tags")?.value || ""));

    if(!url || !title || !category){
      alert("Preencha: Link, Título e Categoria.");
      return;
    }

    try{
      if(id){
        await updateVideo(id, { url, title, category, thumb, description, tags });
        clearForm();
        await render();
        toast("Atualizado");
        return;
      }

      await createVideo({ id: uid(), url, title, category, thumb, description, tags });
      clearForm();
      await render();
      toast("Salvo");
    }catch(err){
      console.error(err);
      alert("Erro ao salvar no banco.\n\n" + (err?.message || err));
    }
  });

  // Logout supabase
  bind("btnLogout","click", async ()=>{
    const ok = confirm("Sair do Admin?");
    if(!ok) return;
    await sb().auth.signOut();
    window.location.href = "index.html";
  });
}

document.addEventListener("DOMContentLoaded", async ()=>{
  const ok = await requireAdmin();
  if(!ok) return;

  wire();
  await render();
});
