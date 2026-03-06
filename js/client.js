document.addEventListener("DOMContentLoaded", loadMembres);



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



function displayMembres(list) {

  const container = document.getElementById("listeMembres");
  container.innerHTML = "";

  // aucun membre après filtrage
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
  headerRow.colSpan = 3;
  headerRow.className = "grade-row"; // <-- appliquer la classe sur le td

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
		<td>${m.date || ""}</td>
		<td>${calcAnciennete(m.date)}</td>
    `;

    tbody.appendChild(tr);

  });

  if (headerRow) {
    headerRow.querySelector(".count").innerText =
      "(" + compteurGrade + " membres)";
  }

  const totalRow = document.createElement("tr");
  totalRow.innerHTML =
    `<td colspan="3" class="total">Total : ${total} membres</td>`;

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

  return jours + " j";

}

