async function apiRequest(action, data = null, method = "GET") {

    try {

        let url = API_URL;
        let options = { method };

        if (method === "GET") {

            // construction URL avec query params
            const params = new URLSearchParams({ action, ...data });
            url += "?" + params.toString();

        } else {

            // POST
            options.body = JSON.stringify({ action, ...data });

        }

        const res = await fetch(url, options);

        if (!res.ok) {
            throw new Error("Erreur HTTP : " + res.status);
        }

        const json = await res.json();

        if (json.error) {
            throw new Error(json.error);
        }

        return json;

    } catch (err) {

        console.error("API ERROR:", err);
        throw err;

    }
}

async function fetchMembres() {
    return await apiRequest("getMembres");
}

/* ================================
   MEMBRES ACTIFS
================================ */

async function loadMembresActifs() {

	const container = document.getElementById("listeMembres");
	container.innerText = "Chargement...";

	try {

		const membres = await apiRequest("getMembres");

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
				${m.IDDiscord ? '<span"><img src="images/icon-discord.png" alt="Discord"></span> + ' : ''}
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
        let membres = await apiRequest("getMembres");

        // 2️⃣ Récupération des mouvements
        const mouvements = await apiRequest("getMouvements");

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
	table.className = "anciens-table";

    table.innerHTML = `
        <thead>
            <tr>
                <th>#</th>
                <th>Nom Avatar</th>
                <th>Première Entrée</th>
                <th>Dernière Sortie</th>
				<th>Total Présence</th>
				<th>Nbr Périodes</th>
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
            <td>${calcTotalPresence(m.id, mouvements)}</td>
			<td class="nbr-periodes-cell">
				${mouvements.filter(mv => mv.MembreID === m.id && mv.TypeMouvement === "ENTREE").length}
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

    const dateEntree = parseDateISO(dateStr);
    const today = new Date();

    const diff = today - dateEntree;

    const jours = Math.floor(diff / (1000 * 60 * 60 * 24));

    return jours + " j";
}

// Calcule le total de présence d'un membre en jours
function calcTotalPresence(membreId, mouvements) {
    // filtre uniquement les mouvements du membre
    const mv = mouvements.filter(m => m.MembreID === membreId);

    // trier par date croissante
    mv.sort((a,b) => parseDateISO(a.DateEffective) - parseDateISO(b.DateEffective));

    let total = 0;
    let entreeDate = null;

    mv.forEach(m => {
        const type = m.TypeMouvement;
        const date = parseDateISO(m.DateEffective);

        if (type === "ENTREE") {
            entreeDate = date; // début période
        } else if (["SORTIE","BANNISSEMENT","DEMISSION","DESERTION"].includes(type)) {
            if (entreeDate) {
                total += (new Date() - entreeDate)/(1000*60*60*24); // en jours
                entreeDate = null; // réinitialiser pour la prochaine période
            }
        }
    });

    // si le membre est encore “présent” (ENTREE sans sortie)
    if (entreeDate) {
        total += (new Date() - entreeDate)/(1000*60*60*24);
    }

    return Math.round(total) + " j";
}

// Récupère la première date d'entrée pour un membre
function getPremiereEntree(membreId, mouvements) {
    const entrees = mouvements.filter(m => m.MembreID === membreId && m.TypeMouvement === "ENTREE");
    if (!entrees.length) return "";
    entrees.sort((a,b) => parseDateISO(a.DateEffective) - parseDateISO(b.DateEffective));

	const d = parseDateISO(entrees[0].DateEffective);
	return formatDate(d);
}

// Récupère la dernière sortie pour un membre
function getDerniereSortie(membreId, mouvements) {
    const sorties = mouvements.filter(m => 
        m.MembreID === membreId &&
        (m.TypeMouvement === "SORTIE" || m.TypeMouvement === "BANNISSEMENT" || m.TypeMouvement === "DEMISSION" || m.TypeMouvement === "DESERTION")
    );
    if (!sorties.length) return "";
    sorties.sort((a,b) => parseDateISO(b.DateEffective) - parseDateISO(a.DateEffective));

	const d = parseDateISO(sorties[0].DateEffective);
	return formatDate(d);
}

// Format date jj/mm/yyyy
function formatDate(date) {
    return ("0"+date.getDate()).slice(-2)+"/"+
           ("0"+(date.getMonth()+1)).slice(-2)+"/"+
           date.getFullYear();
}

async function sendDiscordWebhook(payload) {
    try {
        // Si c'est une chaîne de caractères, on l'envoie en tant que content
        const body = typeof payload === "string"
            ? { content: payload }
            : payload; // si c'est déjà un objet (embed)

        await fetch(WH_NOTIF_RH, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

    } catch (err) {
        console.error("Webhook Discord ERROR:", err);
    }
}

// ================================
// CHARGEMENT FICHE
// ================================
async function loadFiche(membreId) {
  const container = document.getElementById("ficheMembre");
  container.innerHTML = "Chargement...";

  try {

    const data = await apiRequest("getFiche", { id: membreId });

    displayFiche(container, data.membre, data.historique);

  } catch (err) {

    console.error(err);
    container.innerHTML = "Erreur chargement";

  }
}

// ================================
// AFFICHAGE FICHE
// ================================
function displayFiche(container, membre, mouvements) {
  container.innerHTML = "";

  if (!membre) {
    container.innerHTML = "<p>Membre introuvable.</p>";
    return;
  }

  container.appendChild(buildCardMembre(membre));
  container.appendChild(buildCardHistorique(mouvements)); // <== on passe tout l’historique
}

// ================================
// CARTE MEMBRE
// ================================
function buildCardMembre(m) {

    const container = document.createElement("div");

    // -----------------------------
    // Card 1 : Nom + Grade
    // -----------------------------
    const card1 = document.createElement("div");
    card1.className = "card";

    card1.innerHTML = `
        <h2 style="text-align:center; font-size:2em; margin-bottom:0.2em;">${m.nom}</h2>
        <div style="text-align:center; font-weight:bold; font-style:italic; font-size:1.2em;">
            ${m.grade || ""}
        </div>
    `;
    container.appendChild(card1);

    // -----------------------------
    // Card 2 : Informations
    // -----------------------------
    const card2 = document.createElement("div");
    card2.className = "card";

    card2.innerHTML = `
        <h2>Informations</h2>
        <div class="fiche-grid">
            <div><b>Première entrée :</b> ${m.datePremiere ? formatDate(new Date(m.datePremiere)) : ""}</div>
            <div>
                <b>Discord :</b>
                ${m.IDDiscord ?
                    `<img src="images/icon-discord.png" class="icon-discord"> ${m.IDDiscord}` :
                    "non renseigné"}
            </div>
            <div>
                <b>Règles SOC :</b>
                ${m.regleSoc ?
                    '<span class="regle-ok">Oui</span>' :
                    '<span class="regle-ko">Non</span>'}
            </div>
        </div>
    `;
    container.appendChild(card2);
	
	if (isAdmin) {

		// -----------------------------
		// Bouton Synchroniser Discord
		// -----------------------------
		if(m.IDDiscord) {
			const btnDiv = document.createElement("div");
			btnDiv.style.textAlign = "center";
			btnDiv.style.margin = "20px 0";
	
			const btn = document.createElement("button");
			btn.className = "btn-sync-discord";
			btn.innerText = "🔄 Synchroniser Discord";

			btn.onclick = async () => {

				btn.disabled = true;
				btn.innerText = "⏳ Synchronisation...";
				let success = false

				try {

					const data = await apiRequest("syncDiscordFromWeb", {
						membreId: m.id,
						nomAvatar: m.nom,
						discordId: m.IDDiscord
					}, "POST");

					success = true
					btn.innerText = "✅ OK";

				} catch(err) {
				
					btn.innerText = "❌ Erreur";

				} finally {

					setTimeout(() => {
						btn.disabled = false;
						btn.innerText = "🔄 Synchroniser Discord";
					}, 2000);
				
					// 🔥 Construction embed
					const now = new Date();

					const dateStr =
						("0"+now.getDate()).slice(-2) + "/" +
						("0"+(now.getMonth()+1)).slice(-2) + "/" +
						now.getFullYear() + " " +
						("0"+now.getHours()).slice(-2) + ":" +
						("0"+now.getMinutes()).slice(-2);

					// couleur : vert = succès, rouge = erreur
					const color = success ? 0x2ecc71 : 0xe74c3c;

					const embed = {
						title: "🔄 Synchronisation Discord (pour vérification)",
						description: success
							? '✅ Synchronisation effectuée'
							: '❌ Erreur lors de la synchronisation\n\nRôle notifié : <@&464706697408020482>',
						color: color,
						fields: [
							{
								name: "Membre",
								value: m.nom,
								inline: true
							},
							{
								name: "Discord",
								value: `<@${m.IDDiscord}>`,
								inline: true
							},
							{
								name: "Grade",
								value: m.grade || "N/A",
								inline: true
							},
							{
								name: "Date",
								value: dateStr,
								inline: true
							},
							{ 
								name: "Rôle notifié", 
								value: `<@&464706697408020482>`, 
								inline: false
							}
						],
						footer: {
							text: "Log automatique - Notification R.H."
						},
						timestamp: new Date()
					};

					sendDiscordWebhook({ 
						embeds: [embed] 
					});

				}

			};


			btnDiv.appendChild(btn);
			container.appendChild(btnDiv);
		}
	}

    return container;
}

// ================================
// CARTE HISTORIQUE
// ================================
function buildCardHistorique(mouvements) {
  const card = document.createElement("div");
  card.className = "card";

  // S'assurer que mouvements est bien un tableau
  if (!Array.isArray(mouvements) || !mouvements.length) {
    card.innerHTML = "<p>Aucun mouvement.</p>";
    return card;
  }

  // Tri DESC sur la date
  mouvements.sort((a,b) => parseDateISO(b.date) - parseDateISO(a.date));

  let html = `
    <h2>Historique des mouvements</h2>
    <table class="historique-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Nouveau grade</th>
        </tr>
      </thead>
      <tbody>
  `;

  mouvements.forEach(m => {
    html += `
      <tr>
        <td>${formatDate(parseDateISO(m.date))}</td>
        <td>${m.type}</td>
        <td>${m.grade || ""}</td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  card.innerHTML = html;
  return card;
}

async function loadMouvementsMensuels() {

	const container = document.getElementById("mouvementsContainer");
	container.innerHTML = "Chargement...";

	try {

		mouvementsData = await apiRequest("getMouvementsMensuels");

		renderMouvements();

	} catch(err) {

		console.error(err);
		container.innerHTML = "Erreur chargement";

	}

}

function displayMouvementsMensuels(container, mouvements) {

	const entrees = [];
	const sorties = [];
	const grades = [];
	const desertions = [];

	mouvements.forEach(m => {

		const date = formatDate(parseDateISO(m.date));

		if (m.type === "ENTREE")
			entrees.push({
				id: m.id,
				label: `${m.nom} (${date})`
			});

		if (m.type === "SORTIE" || m.type === "BANISSEMENT" || m.type === "DEMISSION")
			sorties.push({
				id: m.id,
				label: `${m.nom} (${date})`
			});

		if (m.type === "PROMOTION")
			grades.push({
				id: m.id,
				label: `${m.nom} ⤴️ ${m.grade} (${date})`
			});

		if (m.type === "RETROGRADATION")
			grades.push({
				id: m.id,
				label: `${m.nom} ⤵️ ${m.grade} (${date})`
			});

		if (m.type === "DESERTION")
			desertions.push({
				id: m.id,
				label: `${m.nom} (${date})`
			});

	});

	entrees.sort((a,b)=>a.label.localeCompare(b.label));
	sorties.sort((a,b)=>a.label.localeCompare(b.label));
	grades.sort((a,b)=>a.label.localeCompare(b.label));
	desertions.sort((a,b)=>a.label.localeCompare(b.label));

	let totalCards = 0;

	if (entrees.length) {
		container.appendChild(buildCardListe("📥 Ils nous ont rejoints :", entrees));
		totalCards++;
	}

	if (sorties.length) {
		container.appendChild(buildCardListe("📤 Ils nous ont quittés :", sorties));
		totalCards++;
	}

	if (grades.length) {
		container.appendChild(buildCardListe("🔃 Ils ont changés de grade :", grades));
		totalCards++;
	}

	if (desertions.length) {
		container.appendChild(buildCardListe("⚰️ Ils sont portés déserteurs :", desertions));
		totalCards++;
	}

	if (totalCards === 0) {
		container.appendChild(buildCardListe("📥 📤 🔃 ⚰️ Aucun mouvement enregistré ce mois-ci", []));
	}

}

function buildCardListe(titre, items){

	const card = document.createElement("div");
	card.className = "card";

	const h2 = document.createElement("h2");
	h2.innerText = titre;

	const ul = document.createElement("ul");

	items.forEach(i=>{

		const li = document.createElement("li");

		li.className = "membre-row";
		li.innerText = i.label;

		// même logique que tes tableaux
		li.dataset.id = i.id;

		li.addEventListener("click", function(){
			window.location.href = "fiche.html?id=" + li.dataset.id;
		});

		ul.appendChild(li);

	});

	card.appendChild(h2);
	card.appendChild(ul);

	return card;

}

let mouvementsData = [];

let moisCourant = new Date().getMonth();
let anneeCourante = new Date().getFullYear();

// récupération session
const storedMois = sessionStorage.getItem("mouvementsMois");
const storedAnnee = sessionStorage.getItem("mouvementsAnnee");

if(storedMois !== null && storedAnnee !== null){
	moisCourant = parseInt(storedMois);
	anneeCourante = parseInt(storedAnnee);
}

function renderMouvements(){

	const container = document.getElementById("mouvementsContainer");
	container.innerHTML = "";

	container.appendChild(buildCardFiltre());

	const filtered = mouvementsData.filter(m => {

		const d = parseDateISO(m.date);

		return (
			d.getMonth() === moisCourant &&
			d.getFullYear() === anneeCourante
		);

	});

	displayMouvementsMensuels(container, filtered);

}

function buildCardFiltre(){

	const card = document.createElement("div");
	card.className = "card";

	const moisNoms = [
		"Janvier","Février","Mars","Avril","Mai","Juin",
		"Juillet","Août","Septembre","Octobre","Novembre","Décembre"
	];

	const header = document.createElement("div");
	header.style.textAlign = "center";
	header.style.fontSize = "1.2em";
	header.style.fontWeight = "bold";

	const prev = document.createElement("span");
	prev.innerHTML = "&#9664;&#9664;";
	prev.style.cursor = "pointer";
	prev.style.marginRight = "20px";

prev.onclick = ()=>{

	moisCourant--;

	if(moisCourant < 0){
		moisCourant = 11;
		anneeCourante--;
	}

	sessionStorage.setItem("mouvementsMois", moisCourant);
	sessionStorage.setItem("mouvementsAnnee", anneeCourante);

	renderMouvements();
};

	const next = document.createElement("span");
	next.innerHTML = "&#9654;&#9654;";
	next.style.cursor = "pointer";
	next.style.marginLeft = "20px";

next.onclick = ()=>{

	moisCourant++;

	if(moisCourant > 11){
		moisCourant = 0;
		anneeCourante++;
	}

	sessionStorage.setItem("mouvementsMois", moisCourant);
	sessionStorage.setItem("mouvementsAnnee", anneeCourante);

	renderMouvements();
};

	const label = document.createElement("span");
	label.innerText = moisNoms[moisCourant] + " " + anneeCourante;

	header.appendChild(prev);
	header.appendChild(label);
	header.appendChild(next);

	card.appendChild(header);

	return card;

}