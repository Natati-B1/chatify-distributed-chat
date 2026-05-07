const form = document.getElementById("regForm");
const errBox = document.getElementById("regError");

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  errBox.classList.remove("is-visible");
  errBox.textContent = "";

  const displayName = document.getElementById("displayName").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ displayName, email, password }),
  });

  if (res.ok) {
    window.location.href = "/chat.html";
    return;
  }

  let msg = "Could not create account.";
  try {
    const data = await res.json();
    if (data.error) msg = data.error;
  } catch {
    /* ignore */
  }
  errBox.textContent = msg;
  errBox.classList.add("is-visible");
});