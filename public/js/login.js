const form = document.getElementById("loginForm");
const errBox = document.getElementById("loginError");
const forgot = document.getElementById("forgotLink");

forgot?.addEventListener("click", (e) => {
  e.preventDefault();
  alert("Password reset is not enabled in this demo.");
});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  errBox.classList.remove("is-visible");
  errBox.textContent = "";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });

  if (res.ok) {
    window.location.href = "/chat.html";
    return;
  }

  let msg = "Login failed.";
  try {
    const data = await res.json();
    if (data.error) msg = data.error;
  } catch {
    
  }
  errBox.textContent = msg;
  errBox.classList.add("is-visible");
});