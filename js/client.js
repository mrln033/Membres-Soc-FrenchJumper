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

		tr.className = "membre-row";
		tr.dataset.id = m.id;

		tr.innerHTML = `
			<td>${compteurGrade}</td>
			<td>${m.nom}</td>
			<td>${m.date ? m.date + " (" + m.entreeCount + ")" : ""}</td>
			<td>${calcAnciennete(m.date)}</td>
			<td class="regle-cell">
				${m.regleSoc ? '<span class="regle-ok">Oui</span>' : '<span class="regle-ko">Non</span>'}
			</td>
		`;

		tr.addEventListener("click", () => {
			window.location.href = "fiche.html?id=" + tr.dataset.id;
		});

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

// -----------------------------
// Chargement et affichage Anciens Membres
// -----------------------------
async function loadMembresAnciens() {

    const container = document.getElementById("listeMembres");
    container.innerText = "Chargement...";

    try {
        // 1️⃣ Récupération des membres
        const resMembres = await fetch(API_URL + "?action=getMembres");
        let membres = await resMembres.json();

        // 2️⃣ Récupération des mouvements
        const resMouvements = await fetch(API_URL + "?action=getMouvements"); // on crée un endpoint côté Code.gs pour renvoyer HISTORIQUE_MOUVEMENTS
        const mouvements = await resMouvements.json();

        // 3️⃣ Filtrage anciens membres (niveau 0)
        const anciens = membres.filter(m => m.niveau === 0);

        // 4️⃣ Affichage
        displayMembresAnciens(anciens, mouvements);

    } catch(err) {
        console.error(err);
        container.innerText = "Erreur chargement";
    }
}

// -----------------------------
// Affichage tableau Anciens Membres
// -----------------------------
function displayMembresAnciens(list, mouvements) {

    const container = document.getElementById("listeMembres");
    container.innerHTML = "";

    if (!list.length) {
        container.innerText = "Aucun ancien membre";
        return;
    }

    // tri alphabétique
    list.sort((a,b) => a.nom.localeCompare(b.nom));

    const table = document.createElement("table");

    table.innerHTML = `
        <thead>
            <tr>
                <th>#</th>
                <th>Nom Avatar</th>
                <th>Première Entrée</th>
                <th>Dernière Sortie</th>
                <th>Ancienneté</th>
                <th>Règles</th>
            </tr>
        </thead>
    `;

    const tbody = document.createElement("tbody");
    let compteur = 0;

    list.forEach(m => {
        compteur++;

        const tr = document.createElement("tr");
        tr.className = "membre-row";
        tr.dataset.id = m.id;

        const premiere = getPremiereEntree(m.id, mouvements);
        const derniere = getDerniereSortie(m.id, mouvements);
        const anciennete = premiere ? calcAnciennete(premiere) : "";

        tr.innerHTML = `
            <td>${compteur}</td>
            <td>${m.nom}</td>
            <td>${premiere}</td>
            <td>${derniere}</td>
            <td>${anciennete}</td>
            <td class="regle-cell">
                ${m.regleSoc ? '<span class="regle-ok">Oui</span>' : '<span class="regle-ko">Non</span>'}
            </td>
        `;

        tr.addEventListener("click", () => {
            window.location.href = "fiche.html?id=" + tr.dataset.id;
        });

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

// Récupère la première date d'entrée pour un membre
function getPremiereEntree(membreId, mouvements) {
    const entrees = mouvements.filter(m => m.MembreID === membreId && m.TypeMouvement === "ENTREE");
    if (!entrees.length) return "";
    entrees.sort((a,b) => new Date(a.DateEffective) - new Date(b.DateEffective));
    const d = new Date(entrees[0].DateEffective);
    return formatDate(d);
}

// Récupère la dernière sortie pour un membre
function getDerniereSortie(membreId, mouvements) {
    const sorties = mouvements.filter(m => 
        m.MembreID === membreId &&
        (m.TypeMouvement === "SORTIE" || m.TypeMouvement === "BANNISSEMENT" || m.TypeMouvement === "DEMISSION")
    );
    if (!sorties.length) return "";
    sorties.sort((a,b) => new Date(b.DateEffective) - new Date(a.DateEffective));
    const d = new Date(sorties[0].DateEffective);
    return formatDate(d);
}

// Format date jj/mm/yyyy
function formatDate(date) {
    return ("0"+date.getDate()).slice(-2)+"/"+
           ("0"+(date.getMonth()+1)).slice(-2)+"/"+
           date.getFullYear();
}