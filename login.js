// login.js — Martree Academy
const sb = () => window.supabaseClient;
const $ = (id) => document.getElementById(id);

function setMsg(text, isError = false){
  const el = $("msg");
  if(!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "rgba(251,113,133,.95)" : "rgba(167,243,208,.95)";
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

function ensureAdminButton(){
  // Cria um botão "Ir para Admin" sem precisar mexer no HTML
  if (document.getElementById("btnGoAdmin")) return;

  const wrap = document.createElement("div");
  wrap.style.marginTop = "12px";

  const btn = document.createElement("button");
  btn.id = "btnGoAdmin";
  btn.type = "button";
  btn.className = "btn";
  btn.style.width = "100%";
  btn.textContent = "Ir para Admin";
  btn.addEventListener("click", () => (window.location.href = "admin.html"));

  wrap.appendChild(btn);

  // coloca abaixo do botão logout se existir, senão no fim do form
  const logoutBtn = $("btnLogout");
  if (logoutBtn?.parentElement) logoutBtn.parentElement.appendChild(wrap);
  else $("formLogin")?.appendChild(wrap);
}

function setBusy(isBusy){
  const loginBtn = $("btnLogin");
  const signupBtn = $("btnSignup");
  const email = $("email");
  const pass = $("password");

  if(loginBtn) loginBtn.disabled = isBusy;
  if(signupBtn) signupBtn.disabled = isBusy;
  if(email) email.disabled = isBusy;
  if(pass) pass.disabled = isBusy;

  if(loginBtn) loginBtn.textContent = isBusy ? "Entrando..." : "Entrar";
}

async function handleLogin(e){
  e.preventDefault();
  setMsg("");

  const email = ($("email")?.value || "").trim();
  const password = ($("password")?.value || "").trim();

  if(!email || !password){
    setMsg("Preencha e-mail e senha.", true);
    return;
  }

  try{
    setBusy(true);

    const { error } = await sb().auth.signInWithPassword({ email, password });
    if(error) throw error;

    setMsg("Login realizado com sucesso!");

    // se for admin, manda pro admin; se não, volta pro index
    const okAdmin = await isAdmin();
    window.location.href = okAdmin ? "admin.html" : "index.html";
  }catch(err){
    console.error(err);
    // mensagens comuns do supabase
    const msg = err?.message || "Erro ao entrar.";
    setMsg(msg, true);
  }finally{
    setBusy(false);
  }
}

async function handleSignup(){
  setMsg("");

  const email = ($("email")?.value || "").trim();
  const password = ($("password")?.value || "").trim();

  if(!email || !password){
    setMsg("Preencha e-mail e senha.", true);
    return;
  }

  if(password.length < 6){
    setMsg("A senha precisa ter pelo menos 6 caracteres.", true);
    return;
  }

  try{
    setBusy(true);

    // se você tiver email confirmation ligado no Supabase, ele vai pedir verificação por email
    const { data, error } = await sb().auth.signUp({ email, password });
    if(error) throw error;

    // se já cria sessão na hora (dependendo da config)
    const hasSession = !!data?.session;

    if(hasSession){
      setMsg("Conta criada e você já está logado!");
      const okAdmin = await isAdmin();
      window.location.href = okAdmin ? "admin.html" : "index.html";
    }else{
      setMsg("Conta criada! Verifique seu e-mail para confirmar o cadastro (se estiver ativado).");
    }
  }catch(err){
    console.error(err);
    setMsg(err?.message || "Erro ao criar conta.", true);
  }finally{
    setBusy(false);
  }
}

async function handleLogout(){
  setMsg("");
  try{
    await sb().auth.signOut();
    setMsg("Sessão encerrada.");
  }catch(err){
    console.error(err);
    setMsg("Erro ao sair.", true);
  }
}

async function refreshUI(){
  try{
    const { data: { session } } = await sb().auth.getSession();

    if(session){
      setMsg("Você já está logado.");

      // mostra botão admin se for admin
      const okAdmin = await isAdmin();
      if(okAdmin) ensureAdminButton();
    }else{
      setMsg("");
    }
  }catch(err){
    console.error(err);
  }
}

document.addEventListener("DOMContentLoaded", async ()=>{
  // wire
  $("formLogin")?.addEventListener("submit", handleLogin);
  $("btnSignup")?.addEventListener("click", handleSignup);
  $("btnLogout")?.addEventListener("click", handleLogout);

  // atualiza quando sessão muda (login/logout)
  sb().auth.onAuthStateChange((_event, _session) => {
    refreshUI();
  });

  await refreshUI();
});
