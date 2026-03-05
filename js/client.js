// client.js - Version finale

document.addEventListener("DOMContentLoaded", function() {
  loadMembres();
});

async function loadMembres() {
  const container = document.getElementById("listeMembres");
  container.innerText = "Chargement...";

  try {
    const res = await fetch(API_URL + "?action=getHome");
    const list = await res.json();

    if (!Array.isArray(list)) throw new Error("Liste reçue invalide");
    displayMembresParGrade(list);

  } catch(err) {
    console.error("Erreur serveur :", err);
    container.innerText = "Erreur chargement.";
  }
}

async function displayMembresParGrade(list) {
  const container = document.getElementById("listeMembres");
  container.innerHTML = "";

  if (!list || !list.length) {
    container.innerText = "Aucun membre actif.";
    return;
  }

  let grades = [];
  try {
    const res = await fetch(API_URL + "?action=grades");
    grades = await res.json();
    if (!Array.isArray(grades)) throw new Error("Grades non reçus correctement");
  } catch(err) {
    console.error("Grades non reçus correctement :", err);
    container.innerText = "Erreur affichage grades.";
    return;
  }

  const gradeMap = {};
  grades.forEach(g => {
    gradeMap[g.Niveau] = g.NomGrade;
  });

  list.sort((a, b) => {
    if (b.Niveau !== a.Niveau) return b.Niveau - a.Niveau;
    return a.NomAvatar.localeCompare(b.NomAvatar);
  });

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>#</th>
        <th>Nom Avatar</th>
        <th>Date Première Entrée</th>
      </tr>
    </thead>
  `;

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
      <td><span>${m.NomAvatar}</span></td>
      <td>${m.DatePremiereEntree ? new Date(m.DatePremiereEntree).toLocaleDateString("fr-FR") : ""}</td>
    `;
    tbody.appendChild(tr);
  });

  if (currentNiveau !== null && gradeRowTitle) {
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

// =================== Formulaire ajout membre ===================
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
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"  // <- essentiel
      },
      body: JSON.stringify({
        action: "addMembre",
        nom: nom,
        date: date
      })
    });

    if (!res.ok) throw new Error("Réponse réseau non OK");

    const result = await res.json();
    msgDiv.style.color = result.success ? "green" : "red";
    msgDiv.textContent = result.message;

    if (result.success) {
      document.getElementById("newNom").value = "";
      document.getElementById("newDate").value = "";
      loadMembres();
    }

  } catch(err) {
    msgDiv.style.color = "red";
    msgDiv.textContent = "Erreur serveur : " + err.message;
    console.error(err);
  }
}