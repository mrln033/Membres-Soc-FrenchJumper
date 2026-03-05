document.addEventListener("DOMContentLoaded", loadMembres);


async function loadMembres() {

  const container = document.getElementById("listeMembres");
  container.innerText = "Chargement...";

  try {

    const res = await fetch(API_URL + "?action=getMembres");
    const membres = await res.json();

    displayMembres(membres);

  } catch(err) {

    console.error(err);
    container.innerText = "Erreur chargement";

  }

}


function displayMembres(list) {

  const container = document.getElementById("listeMembres");

  if (!list.length) {
    container.innerText = "Aucun membre";
    return;
  }

  const table = document.createElement("table");

  table.innerHTML = `
    <thead>
      <tr>
        <th>Nom Avatar</th>
        <th>Date entrée</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");

  list.forEach(m => {

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${m.nom}</td>
      <td>${m.date || ""}</td>
    `;

    tbody.appendChild(tr);

  });

  table.appendChild(tbody);

  container.innerHTML = "";
  container.appendChild(table);

}