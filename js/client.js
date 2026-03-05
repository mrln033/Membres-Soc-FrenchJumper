document.addEventListener("DOMContentLoaded", function() {
  loadMembres();
});

async function api(action, params = {}) {
  const url = new URL(API_URL);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url);
  return res.json();
}

async function loadMembres() {
  const container = document.getElementById("listeMembres");
  container.innerText = "Chargement...";
  
  try {
    const list = await api("getHome");
    displayMembresParGrade(list);
  } catch(err) {
    console.error("Erreur serveur :", err);
    container.innerText = "Erreur chargement.";
  }
}

async function displayMembresParGrade(list) {
  const container = document.getElementById("listeMembres");
  container.innerHTML = "";

  if (!list || list.length === 0) {
    container.innerText = "Aucun membre actif.";
    return;
  }

  let grades;
  try {
    grades = await api("grades");
  } catch(err) {
    console.error(err);
    container.innerText = "Erreur affichage grades.";
    return;
  }

  const gradeMap = {};
  grades.forEach(g => { gradeMap[g.Niveau] = g.NomGrade; });

  list.sort((a, b) => {
    if (b.Niveau !== a.Niveau) return b.Niveau - a.Niveau;
    return a.NomAvatar.localeCompare(b.NomAvatar);
  });

  const table = document.createElement("table");

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>#</th>
      <th>Nom Avatar</th>
      <th>Date Première Entrée</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  let currentNiveau = null;
  let compteurGrade = 0;
  let totalGlobal = 0;
  let gradeRowTitle = null;

  list.forEach(m => {
    if (m.Niveau !== currentNiveau) {
      if (currentNiveau !== null && gradeRowTitle) {
        gradeRowTitle.querySelector(".grade-count").innerText =
          `(${compteurGrade} membres)`;
      }
      currentNiveau = m.Niveau;
      compteurGrade = 0;

      const gradeRow = document.createElement("tr");
      gradeRowTitle = document.createElement("td");
      gradeRowTitle.colSpan = 3;
      gradeRowTitle.className = "grade-row";

      gradeRowTitle.innerHTML = `
        <div class="grade-header">
          <h2>${gradeMap[currentNiveau] || ("Grade " + currentNiveau)}</h2>
          <span class="grade-count"></span>
        </div>
      `;
      gradeRow.appendChild(gradeRowTitle);
      tbody.appendChild(gradeRow);
    }

    compteurGrade++;
    totalGlobal++;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="num-col">${compteurGrade}</td>
      <td>
        <a href="#" onclick="openFiche('${m.MembreID}')">
          ${m.NomAvatar}
        </a>
      </td>
      <td>${m.DatePremiereEntree ? new Date(m.DatePremiereEntree).toLocaleDateString("fr-FR") : ""}</td>
    `;
    tbody.appendChild(tr);
  });

  if (currentNiveau !== null) {
    gradeRowTitle.querySelector(".grade-count").innerText =
      `(${compteurGrade} membres)`;
  }

  const totalRow = document.createElement("tr");
  totalRow.innerHTML = `
    <td colspan="3" class="total-row">
      Total général : ${totalGlobal} membres
    </td>
  `;
  tbody.appendChild(totalRow);

  table.appendChild(tbody);
  container.appendChild(table);
}

async function openFiche(membreId) {
  const modal = document.getElementById("modalFiche");
  const container = document.getElementById("modalFicheContainer");

  modal.style.display = "flex";
  container.innerText = "Chargement...";

  document.getElementById("closeFiche").onclick = () => {
    modal.style.display = "none";
  };

  try {
    const data = await api("getFiche", { id: membreId });

    if (!data) {
      container.innerText = "Aucune donnée trouvée.";
      return;
    }

    container.innerHTML = `
      <h2>${data.NomAvatar}</h2>
      <p><strong>Grade :</strong> ${data.Grade}</p>
      <p><strong>Date entrée :</strong> ${data.DatePremiereEntree || ""}</p>
      <p><strong>Statut :</strong> ${data.Statut || ""}</p>

      <h3>Historique</h3>
      <table border="1" style="width:100%; border-collapse:collapse;">
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Grade</th>
          <th>Commentaire</th>
        </tr>
        ${(data.Historique || []).map(h => `
          <tr>
            <td>${h.DateEffective || ""}</td>
            <td>${h.Type || ""}</td>
            <td>${h.NouveauGrade || h.AncienGrade || ""}</td>
            <td>${h.Commentaire || ""}</td>
          </tr>
        `).join("")}
      </table>
    `;
  } catch(err) {
    console.error(err);
    container.innerText = "Erreur : " + err;
  }
}

async function submitNewMembre() {
  const nom = document.getElementById("newNom").value.trim();
  const date = document.getElementById("newDate").value;
  const msgDiv = document.getElementById("addMsg");

  if (!nom || !date) {
    msgDiv.style.color = "red";
    msgDiv.textContent = "Veuillez remplir tous les champs.";
    return;
  }

  msgDiv.style.color = "black";
  msgDiv.textContent = "Traitement en cours...";

  try {
    const result = await api("addOrUpdateMembreRobuste", { nom, date });

    if (result.success) {
      msgDiv.style.color = "green";
      document.getElementById("newNom").value = "";
      document.getElementById("newDate").value = "";
      loadMembres();
    } else {
      msgDiv.style.color = "red";
    }
    msgDiv.textContent = result.message;
  } catch(err) {
    msgDiv.style.color = "red";
    msgDiv.textContent = "Erreur serveur : " + err.message;
  }
}