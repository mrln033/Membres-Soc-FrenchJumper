document.addEventListener("DOMContentLoaded", loadMembres);

/* =======================================================
   CHARGEMENT DES MEMBRES
======================================================= */
async function loadMembres() {
  const container = document.getElementById("listeMembres");
  container.innerText = "Chargement...";

  try {
    const res = await fetch(API_URL + "?action=getMembres");
    const membres = await res.json();

    // Filtrage : ne garder que les membres dont le niveau est entre 1 et 6
    const filtered = membres.filter(m => m.niveau >= 1 && m.niveau <= 6);

    displayMembres(filtered);

  } catch(err) {
    console.error(err);
    container.innerText = "Erreur chargement";
  }
}

/* =======================================================
   AFFICHAGE DES MEMBRES
======================================================= */
function displayMembres(list) {
  const container = document.getElementById("listeMembres");
  container.innerHTML = "";

  if (!list.length) {
    container.innerText = "Aucun membre";
    return;
  }

  // tri : niveau desc puis nom
  list.sort((a,b) => {
    if (b.niveau !== a.niveau) return b.niveau - a.niveau;
    return a.nom.localeCompare(b.nom);
  });

  const table = document.createElement("table");

  table.innerHTML = `
    <thead>
      <tr>
        <th>#</th>
        <th>Nom Avatar</th>
        <th>Date entrée</th>
        <th>Ancienneté</th>
        <th>Règles</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");

  let niveauActuel = null;
  let compteurGrade = 0;
  let total = 0;
  let headerRow = null;

  list.forEach(m => {

    if (m.niveau !== niveauActuel) {
      if (headerRow) {
        headerRow.querySelector(".count").innerText =
          "(" + compteurGrade + " membres)";
      }

      niveauActuel = m.niveau;
      compteurGrade = 0;

      const tr = document.createElement("tr");
      headerRow = document.createElement("td");
      headerRow.colSpan = 5;
      headerRow.className = "grade-row";
      headerRow.innerHTML =
        "<strong>" + m.grade + "</strong> <span class='count'></span>";

      tr.appendChild(headerRow);
      tbody.appendChild(tr);
    }

    compteurGrade++;
    total++;

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${compteurGrade}</td>
      <td>${m.nom}</td>
      <td>${m.date ? m.date + " (" + m.entreeCount + ")" : ""}</td>
      <td>${calcAnciennete(m.date)}</td>
      <td class="regle-cell">
        ${m.regleSoc ? '<span class="regle-ok">Oui</span>' : '<span class="regle-ko">Non</span>'}
      </td>
    `;

    tbody.appendChild(tr);
  });

  if (headerRow) {
    headerRow.querySelector(".count").innerText =
      "(" + compteurGrade + " membres)";
  }

  const totalRow = document.createElement("tr");
  totalRow.innerHTML =
    `<td colspan="5" class="total">Total : ${total} membres</td>`;

  tbody.appendChild(totalRow);
  table.appendChild(tbody);
  container.appendChild(table);
}

/* =======================================================
   CALCUL ANCIENNETÉ
======================================================= */
function calcAnciennete(dateStr) {
  if (!dateStr) return "";

  const [jour, mois, an] = dateStr.split("/");
  const dateEntree = new Date(an, mois - 1, jour);
  const today = new Date();
  const diff = today - dateEntree;
  const jours = Math.floor(diff / (1000 * 60 * 60 * 24));
  return jours + " jours";
}

/* =======================================================
   OUVERTURE FICHE MEMBRE
======================================================= */
function openFicheMembre(membreId) {
  if (!membreId) return;
  window.location.href = "fiche.html?membreId=" + encodeURIComponent(membreId);
}

/* =======================================================
   MODAL
======================================================= */
function showModal(message, okCallback=null, cancelCallback=null) {
  const overlay = document.getElementById("modalOverlay");
  const msgEl = document.getElementById("modalMessage");
  const btnOk = document.getElementById("modalOk");
  const btnCancel = document.getElementById("modalCancel");

  msgEl.innerText = message;

  btnOk.onclick = () => {
    overlay.style.display = "none";
    if (okCallback) okCallback();
  };

  if (cancelCallback) {
    btnCancel.style.display = "inline-block";
    btnCancel.onclick = () => {
      overlay.style.display = "none";
      cancelCallback();
    };
  } else {
    btnCancel.style.display = "none";
  }

  overlay.style.display = "flex";
}

/* =======================================================
   AJOUT NOUVEAU MEMBRE
======================================================= */
async function addMembre() {

  const nom = document.getElementById("newNom").value.trim();
  const date = document.getElementById("newDate").value;

  if (!nom || !date) {
    showModal("Veuillez renseigner le nom et la date.");
    return;
  }

  try {

    const payload = {
      nomAvatar: nom,
      dateEntree: date,
      gradeId: "eea478c0-3223-4d58-b256-59e1cc0e6600"
    };

    const res = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });

    const result = await res.json();

    /* -------------------------
       MEMBRE EXISTE
    ------------------------- */

    if (result.exists) {

      showModal(
        `Le membre "${nom}" existe déjà dans la base.`,
        () => openFicheMembre(result.membreId),
        () => {}
      );

      return;
    }

    /* -------------------------
       AJOUT OK
    ------------------------- */

    if (result.success && result.membreId) {
      openFicheMembre(result.membreId);
      return;
    }

    showModal("Erreur lors de l'ajout du membre.");

  } catch (err) {

    console.error(err);
    showModal("Erreur communication serveur.");

  }

}