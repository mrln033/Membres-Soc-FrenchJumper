document.addEventListener("DOMContentLoaded", loadMembres);

async function loadMembres() {

  const container = document.getElementById("listeMembres");
  container.innerText = "Chargement...";

  try {

    const res = await fetch(API_URL + "?action=getMembres");
    const membres = await res.json();

    const filtered = membres.filter(m => m.niveau >= 1 && m.niveau <= 6);

    displayMembres(filtered);

  } catch(err) {

    console.error(err);
    container.innerText = "Erreur chargement";

  }

}

function displayMembres(list) {

  const container = document.getElementById("listeMembres");
  container.innerHTML = "";

  if (!list.length) {
    container.innerText = "Aucun membre";
    return;
  }

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

function calcAnciennete(dateStr) {

  if (!dateStr) return "";

  const [jour, mois, an] = dateStr.split("/");

  const dateEntree = new Date(an, mois - 1, jour);
  const today = new Date();

  const diff = today - dateEntree;

  const jours = Math.floor(diff / (1000 * 60 * 60 * 24));

  return jours + " jours";

}


/* ===========================
   AJOUT MEMBRE
=========================== */

async function addMembre(){

  const nom = document.getElementById("newNom").value.trim();
  const date = document.getElementById("newDate").value;

  if(!nom || !date){
    alert("Nom et date obligatoires");
    return;
  }

  try{

    const res = await fetch(API_URL + "?action=addMembre",{
      method:"POST",
      body:JSON.stringify({nom,date})
    });

    const data = await res.json();

    if(data.exists){

      showModal(
        "Ce membre existe déjà dans la base.<br><br>Ouvrir sa fiche ?",
        () => {
          window.location = "fiche.html?id=" + data.id;
        }
      );

      return;

    }

    window.location = "fiche.html?id=" + data.id;

  }catch(err){

    console.error(err);
    alert("Erreur ajout");

  }

}


/* ===========================
   MODAL
=========================== */

function showModal(message, onOk){

  const overlay = document.getElementById("modalOverlay");
  const msg = document.getElementById("modalMessage");

  msg.innerHTML = message;

  overlay.style.display = "flex";

  document.getElementById("modalOk").onclick = () => {
    overlay.style.display = "none";
    if(onOk) onOk();
  };

  document.getElementById("modalCancel").onclick = () => {
    overlay.style.display = "none";
  };

}