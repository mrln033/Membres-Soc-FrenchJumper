async function fetchMembres() {

	const res = await fetch(API_URL + "?action=getMembres");
	return await res.json();

}

/* ================================
   MEMBRES ACTIFS
================================ */

async function loadMembresActifs() {

	const container = document.getElementById("listeMembres");
	container.innerText = "Chargement...";

	try {

		const membres = await fetchMembres();

		const filtered = membres.filter(m => m.niveau >= 1 && m.niveau <= 6);

		displayMembresActifs(filtered);

	} catch(err) {

		console.error(err);
		container.innerText = "Erreur chargement";

	}

}

function displayMembresActifs(list) {

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
			<td><a class="membre-link" href="fiche.html?id=${m.id}">${m.nom}</a></td>
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

	totalRow.innerHTML = `
	<td colspan="5" class="total">Total : ${total} membres</td>
	`;

	tbody.appendChild(totalRow);

	table.appendChild(tbody);
	container.appendChild(table);

}


/* ================================
   ANCIENS MEMBRES
================================ */

async function loadMembresAnciens() {

	const container = document.getElementById("listeMembres");
	container.innerText = "Chargement...";

	try {

		const membres = await fetchMembres();

		const filtered = membres.filter(m => m.niveau === 0);

		displayMembresAnciens(filtered);

	} catch(err) {

		console.error(err);
		container.innerText = "Erreur chargement";

	}

}

function displayMembresAnciens(list) {

	const container = document.getElementById("listeMembres");
	container.innerHTML = "";

	if (!list.length) {
		container.innerText = "Aucun ancien membre";
		return;
	}

	list.sort((a,b) => a.nom.localeCompare(b.nom));

	const table = document.createElement("table");

	table.innerHTML = `
	<thead>
	<tr>
	<th>Nom Avatar</th>
	<th>Dernière entrée</th>
	<th>Nb entrées</th>
	</tr>
	</thead>
	`;

	const tbody = document.createElement("tbody");

	list.forEach(m => {

		const tr = document.createElement("tr");

		tr.innerHTML = `
			<td><a class="membre-link" href="fiche.html?id=${m.id}">${m.nom}</a></td>
			<td>${m.date || ""}</td>
			<td>${m.entreeCount}</td>
		`;

		tbody.appendChild(tr);

	});

	table.appendChild(tbody);
	container.appendChild(table);

}


/* ================================
   OUTILS
================================ */

function calcAnciennete(dateStr) {

	if (!dateStr) return "";

	const [jour, mois, an] = dateStr.split("/");

	const dateEntree = new Date(an, mois - 1, jour);
	const today = new Date();

	const diff = today - dateEntree;

	const jours = Math.floor(diff / (1000 * 60 * 60 * 24));

	return jours + " j";

}