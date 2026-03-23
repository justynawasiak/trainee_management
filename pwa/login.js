const form = document.getElementById("loginForm");
const username = document.getElementById("username");
const password = document.getElementById("password");
const error = document.getElementById("error");

function showError(text) {
  error.style.display = "inline-flex";
  error.textContent = text;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.style.display = "none";

  const u = (username.value ?? "").trim();
  const p = password.value ?? "";
  if (!u || !p) return showError("Podaj użytkownika i hasło.");

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: u, password: p })
    });
    if (!res.ok) return showError("Nieprawidłowy użytkownik lub hasło.");
    location.href = "/";
  } catch {
    showError("Błąd połączenia.");
  }
});
