async function apiRequest(action, data = null, method = "GET") {
	console.log("Fonction : client.js - apiRequest(action, data = null, method = 'GET')");

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

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function isTrueField(value) {
	return value === true || String(value).trim().toUpperCase() === "TRUE";
}

async function fetchMembres() {
	console.log("Fonction : client.js - fetchMembres()");
    return await apiRequest("getMembres");
}

/* ================================
   MEMBRES ACTIFS
================================ */

async function loadMembresActifs() {
	console.log("Fonction : client.js - loadMembresActifs()");

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
	console.log("Fonction : client.js - displayMembresActifs(list)");

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
	<th>Serveur + Règles</th>
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
				${isTrueField(m.serveurFRJ) ? '<span><img src="images/icon-discord.png" alt="Discord"></span> + ' : ''}
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
	console.log("Fonction : client.js - loadMembresAnciens()");

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
	console.log("Fonction : client.js - displayMembresAnciens(list, mouvements)");

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
	console.log("Fonction : client.js - calcAnciennete(dateStr)");

	if (!dateStr) return "";

	const [jour, mois, an] = dateStr.split("/");

	const dateEntree = new Date(an, mois - 1, jour);
	const today = new Date();

	const diff = today - dateEntree;

	const jours = Math.floor(diff / (1000 * 60 * 60 * 24));

	return jours + " j";

}

// Calcule le total de présence d'un membre en jours
function calcTotalPresence(membreId, mouvements) {
	console.log("Fonction : client.js - calcTotalPresence(membreId, mouvements)");
    // filtre uniquement les mouvements du membre
    const mv = mouvements.filter(m => m.MembreID === membreId);

    // trier par date croissante
    mv.sort((a,b) => new Date(a.DateEffective) - new Date(b.DateEffective));

    let total = 0;
    let entreeDate = null;

    mv.forEach(m => {
        const type = m.TypeMouvement;
        const date = new Date(m.DateEffective);

        if (type === "ENTREE") {
            entreeDate = date; // début période
        } else if (["SORTIE","BANNISSEMENT","DEMISSION","DESERTION"].includes(type)) {
            if (entreeDate) {
                total += (date - entreeDate)/(1000*60*60*24); // en jours
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

function parseFicheDate(value) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function getFicheEntrees(mouvements) {
	if (!Array.isArray(mouvements)) return [];

	return mouvements
		.filter(m => m.type === "ENTREE" && parseFicheDate(m.date))
		.sort((a,b) => parseFicheDate(a.date) - parseFicheDate(b.date));
}

function calcJoursDepuisDate(date) {
	if (!date) return "";

	const diff = new Date() - date;
	const jours = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
	return jours + " jours";
}

function calcTotalPresenceFiche(mouvements) {
	if (!Array.isArray(mouvements)) return "";

	const mv = mouvements
		.filter(m => parseFicheDate(m.date))
		.sort((a,b) => parseFicheDate(a.date) - parseFicheDate(b.date));

	let total = 0;
	let entreeDate = null;

	mv.forEach(m => {
		const date = parseFicheDate(m.date);

		if (m.type === "ENTREE") {
			entreeDate = date;
		} else if (["SORTIE", "BANNISSEMENT", "DEMISSION", "DESERTION"].includes(m.type) && entreeDate) {
			total += (date - entreeDate) / (1000 * 60 * 60 * 24);
			entreeDate = null;
		}
	});

	if (entreeDate) {
		total += (new Date() - entreeDate) / (1000 * 60 * 60 * 24);
	}

	return Math.round(Math.max(0, total)) + " jours";
}

// Récupère la première date d'entrée pour un membre
function getPremiereEntree(membreId, mouvements) {
	console.log("Fonction : client.js - getPremiereEntree(membreId, mouvements)");
    const entrees = mouvements.filter(m => m.MembreID === membreId && m.TypeMouvement === "ENTREE");
    if (!entrees.length) return "";
    entrees.sort((a,b) => new Date(a.DateEffective) - new Date(b.DateEffective));
    const d = new Date(entrees[0].DateEffective);
    return formatDate(d);
}

// Récupère la dernière sortie pour un membre
function getDerniereSortie(membreId, mouvements) {
	console.log("Fonction : client.js - getDerniereSortie(membreId, mouvements)");
    const sorties = mouvements.filter(m => 
        m.MembreID === membreId &&
        (m.TypeMouvement === "SORTIE" || m.TypeMouvement === "BANNISSEMENT" || m.TypeMouvement === "DEMISSION" || m.TypeMouvement === "DESERTION")
    );
    if (!sorties.length) return "";
    sorties.sort((a,b) => new Date(b.DateEffective) - new Date(a.DateEffective));
    const d = new Date(sorties[0].DateEffective);
    return formatDate(d);
}

// Format date jj/mm/yyyy
function formatDate(date) {
	console.log("Fonction : client.js - formatDate(date)");
    return ("0"+date.getDate()).slice(-2)+"/"+
           ("0"+(date.getMonth()+1)).slice(-2)+"/"+
           date.getFullYear();
}

async function sendDiscordWebhook(payload) {
	console.log("Fonction : client.js - sendDiscordWebhook(payload)");
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
	console.log("Fonction : client.js - loadFiche(membreId)");
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
	console.log("Fonction : client.js - displayFiche(container, membre, mouvements)");
  container.innerHTML = "";

  if (!membre) {
    container.innerHTML = "<p>Membre introuvable.</p>";
    return;
  }

  container.appendChild(buildCardMembre(membre, mouvements));
  container.appendChild(buildCardHistorique(mouvements)); // <== on passe tout l’historique
}

// ================================
// CARTE MEMBRE
// ================================
function buildCardMembre(m, mouvements) {
	console.log("Fonction : client.js - buildCardMembre(m, mouvements)");

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

    const nomDiscord = m.nomDiscord ? String(m.nomDiscord).trim() : "";
    const idDiscord = m.IDDiscord ? String(m.IDDiscord).trim() : "";
    const nomDiscordHtml = escapeHtml(nomDiscord);
    const idDiscordHtml = escapeHtml(idDiscord);
    const isServeurFRJ = isTrueField(m.serveurFRJ);
    const entrees = getFicheEntrees(mouvements);
    const premiereEntreeDate = entrees.length ? parseFicheDate(entrees[0].date) : parseFicheDate(m.datePremiere);
    const premiereEntree = premiereEntreeDate ? formatDate(premiereEntreeDate) : "";
    const derniereEntreeDate = entrees.length ? parseFicheDate(entrees[entrees.length - 1].date) : premiereEntreeDate;
    const derniereEntree = derniereEntreeDate ? formatDate(derniereEntreeDate) : "";
    const anciennete = derniereEntreeDate ? calcJoursDepuisDate(derniereEntreeDate) : "";
    const totalPresence = calcTotalPresenceFiche(mouvements);
    const hasMultipleEntrees = entrees.length > 1;
    const isAncienMembre = (m.grade || "").trim() === "Ancien Membre";
    const presenceSocHtml = isAncienMembre ? `
        <div class="fiche-info-line"><span>Périodes : </span> ${entrees.length}</div>
        <div class="fiche-info-line"><span>Présence totale : </span> ${totalPresence}</div>
    ` : `
        <div class="fiche-info-line"><span>Date d'entrée : </span> ${derniereEntree}</div>
        <div class="fiche-info-line"><span>Ancienneté : </span> ${anciennete}</div>
        ${hasMultipleEntrees ? `
            <div class="fiche-info-line"><span>Première entrée : </span> ${premiereEntree}</div>
            <div class="fiche-info-line"><span>Présence totale : </span> ${totalPresence}</div>
        ` : ""}
    `;

    card2.innerHTML = `
        <h2>Informations</h2>
        <div class="fiche-info-grid">
            <div class="fiche-info-panel">
                <div class="fiche-info-title">Présence SOC</div>
                ${presenceSocHtml}
            </div>
            <div class="fiche-info-panel fiche-discord-info">
                <div class="fiche-info-title">Discord</div>
                <div class="fiche-info-line">
                    <span>Nom : </span>
                    ${nomDiscord ?
                        nomDiscordHtml :
                        "non renseigné"}
                </div>
                <div class="fiche-info-line">
                    <span>ID : </span>
                    ${idDiscordHtml || "non renseigné"}
                </div>
            </div>
            <div class="fiche-info-panel fiche-regle-info">
                <div class="fiche-info-title">Serveur SOC</div>
                <div class="fiche-info-line">
                    <span>Discord : </span>
                    ${isServeurFRJ ?
                        '<span class="regle-ok">Inscrit</span>' :
                        '<span class="regle-ko">Non Inscrit</span>'}
                </div>
                <div class="fiche-info-line">
                    <span>Règle Soc : </span>
                ${m.regleSoc ?
                    '<span class="regle-ok">Acceptées</span>' :
                    '<span class="regle-ko">Non Acceptées</span>'}
                </div>
            </div>
        </div>
    `;
    container.appendChild(card2);
	
	if (isAdmin) {
		const btnDiv = document.createElement("div");
		btnDiv.className = "fiche-actions-admin";

		const gradeActuel = (m.grade || "").trim();
		const actionIcons = {
			"Nouvelle Entrée": "✅",
			"Promotion": "⬆️",
			"Rétrogradation": "⬇️",
			"Sortie": "❌"
		};
		let actions = [];

		if (gradeActuel === "Ancien Membre") {
			actions = ["Nouvelle Entrée"];
		} else if (gradeActuel === "Voyageur") {
			actions = ["Promotion", "Sortie"];
		} else if (gradeActuel === "Aventurier Expérimenté") {
			actions = ["Rétrogradation", "Sortie"];
		} else if (
			gradeActuel !== "Chef d'Expédition" &&
			gradeActuel !== "Conseiller d'Expédition"
		) {
			actions = ["Promotion", "Rétrogradation", "Sortie"];
		}

		actions.forEach(actionLabel => {
			const actionBtn = document.createElement("button");
			actionBtn.className = "btn-fiche-action";
			actionBtn.innerText = `${actionIcons[actionLabel]} ${actionLabel}`;
			actionBtn.type = "button";
			actionBtn.onclick = () => handleMembreAction(actionLabel, m, actionBtn);
			btnDiv.appendChild(actionBtn);
		});

		// -----------------------------
		// Bouton Synchroniser Discord
		// -----------------------------
		if(m.IDDiscord && gradeActuel !== "Chef d'Expédition") {
			const btn = document.createElement("button");
			btn.className = "btn-fiche-action btn-sync-discord";
			btn.type = "button";
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
		}

		const editInfoBtn = document.createElement("button");
		editInfoBtn.className = "btn-fiche-action";
		editInfoBtn.type = "button";
		editInfoBtn.innerText = "Modifier infos";
		editInfoBtn.onclick = () => handleEditMembreInfos(m, editInfoBtn);
		btnDiv.appendChild(editInfoBtn);

		if (btnDiv.children.length) {
			container.appendChild(btnDiv);
		}
	}

    return container;
}

function getNowInputValue() {
	const now = new Date();

	return ("0" + now.getDate()).slice(-2) + "-" +
		("0" + (now.getMonth() + 1)).slice(-2) + "-" +
		now.getFullYear() + " " +
		("0" + now.getHours()).slice(-2) + ":" +
		("0" + now.getMinutes()).slice(-2) + ":" +
		("0" + now.getSeconds()).slice(-2);
}

function getMembreActionType(actionLabel) {
	const actionTypes = {
		"Nouvelle Entrée": "ENTREE",
		"Promotion": "PROMOTION",
		"Rétrogradation": "RETROGRADATION",
		"Sortie": "SORTIE"
	};

	return actionTypes[actionLabel] || "";
}

async function handleMembreAction(actionLabel, membre, btn) {
	console.log("Fonction : client.js - handleMembreAction(actionLabel, membre, btn)");

	const actionType = getMembreActionType(actionLabel);

	if (!actionType) {
		await openInfoModal("Erreur", "Action inconnue", "error");
		return;
	}

	const actionData = await openMembreActionModal(actionLabel, membre, actionType);

	if (!actionData) {
		return;
	}

	const initialText = btn.innerText;
	btn.disabled = true;
	btn.innerText = "⏳ Traitement...";

	try {
		const result = await apiRequest("applyMembreAction", {
			membreId: membre.id,
			membreAction: actionData.membreAction,
			dateEffective: actionData.dateEffective
		}, "POST");

		if (result.success === false) {
			throw new Error(result.error || "Erreur inconnue");
		}

		btn.innerText = "✅ OK";

		if (result.syncDiscord && result.syncDiscord.success === false) {
			await openInfoModal(
				"Synchronisation Discord",
				"Action enregistrée, mais synchronisation Discord non effectuée : " + result.syncDiscord.error,
				"warning"
			);
		}

		setTimeout(() => {
			loadFiche(membre.id);
		}, 500);

	} catch (err) {
		console.error(err);
		btn.innerText = "❌ Erreur";
		await openInfoModal("Erreur", err.message || "Erreur lors du traitement", "error");

		setTimeout(() => {
			btn.disabled = false;
			btn.innerText = initialText;
		}, 2000);
	}
}

async function handleEditMembreInfos(membre, btn) {
	console.log("Fonction : client.js - handleEditMembreInfos(membre, btn)");

	const formData = await openEditMembreInfosModal(membre);

	if (!formData) {
		return;
	}

	const initialText = btn.innerText;
	btn.disabled = true;
	btn.innerText = "Traitement...";

	try {
		const result = await apiRequest("updateMembreInfos", {
			membreId: membre.id,
			nomDiscord: formData.nomDiscord,
			IDDiscord: formData.IDDiscord,
			regleSoc: formData.regleSoc,
			serveurFRJ: formData.serveurFRJ
		}, "POST");

		if (result.success === false) {
			throw new Error(result.error || "Erreur inconnue");
		}

		btn.innerText = "OK";
		setTimeout(() => {
			loadFiche(membre.id);
		}, 500);

	} catch (err) {
		console.error(err);
		btn.innerText = "Erreur";
		await openInfoModal("Erreur", err.message || "Erreur lors de la modification", "error");

		setTimeout(() => {
			btn.disabled = false;
			btn.innerText = initialText;
		}, 2000);
	}
}

function openInfoModal(titleText, messageText, type) {
	return new Promise(resolve => {
		const overlay = document.createElement("div");
		overlay.className = "modal-overlay";

		const modal = document.createElement("div");
		modal.className = "modal-action modal-message-box";

		const title = document.createElement("h2");
		title.className = type ? "modal-title-" + type : "";
		title.innerText = titleText;

		const message = document.createElement("p");
		message.className = "modal-message-text";
		message.innerText = messageText;

		const buttons = document.createElement("div");
		buttons.className = "modal-buttons";

		const okBtn = document.createElement("button");
		okBtn.className = "btn-modal btn-modal-primary";
		okBtn.type = "button";
		okBtn.innerText = "OK";

		function close() {
			document.removeEventListener("keydown", onKeyDown);
			overlay.remove();
			resolve();
		}

		function onKeyDown(event) {
			if (event.key === "Escape" || event.key === "Enter") {
				close();
			}
		}

		okBtn.onclick = close;
		overlay.onclick = event => {
			if (event.target === overlay) {
				close();
			}
		};

		buttons.appendChild(okBtn);
		modal.appendChild(title);
		modal.appendChild(message);
		modal.appendChild(buttons);
		overlay.appendChild(modal);
		document.body.appendChild(overlay);
		document.addEventListener("keydown", onKeyDown);
		okBtn.focus();
	});
}

function openMembreActionModal(actionLabel, membre, defaultActionType) {
	return new Promise(resolve => {
		const overlay = document.createElement("div");
		overlay.className = "modal-overlay";

		const modal = document.createElement("div");
		modal.className = "modal-action";

		const title = document.createElement("h2");
		title.innerText = actionLabel;

		const details = document.createElement("p");
		details.className = "modal-action-details";
		details.innerHTML = "<b>Membre :</b> " + membre.nom + "<br><b>Grade actuel :</b> " + (membre.grade || "");

		const label = document.createElement("label");
		label.className = "modal-field-label";
		label.innerText = "Date effective";

		const input = document.createElement("input");
		input.className = "modal-date-input";
		input.type = "text";
		input.value = getNowInputValue();
		input.placeholder = "JJ-MM-AAAA HH:MM:SS";

		const motifWrapper = document.createElement("div");
		let motifSelect = null;

		if (actionLabel === "Sortie") {
			const motifLabel = document.createElement("label");
			motifLabel.className = "modal-field-label";
			motifLabel.innerText = "Motif";

			motifSelect = document.createElement("select");
			motifSelect.className = "modal-select";

			const placeholder = document.createElement("option");
			placeholder.value = "";
			placeholder.innerText = "Indiquer le motif de Sortie";
			placeholder.disabled = true;
			placeholder.selected = true;
			motifSelect.appendChild(placeholder);

			const motifs = membre.grade === "Voyageur"
				? ["SORTIE", "DESERTION", "BANNISSEMENT"]
				: ["SORTIE", "BANNISSEMENT"];

			motifs.forEach(motif => {
				const option = document.createElement("option");
				option.value = motif;
				option.innerText = motif;
				motifSelect.appendChild(option);
			});

			motifWrapper.appendChild(motifLabel);
			motifWrapper.appendChild(motifSelect);
		}

		const error = document.createElement("div");
		error.className = "modal-error";
		error.innerText = "";

		const buttons = document.createElement("div");
		buttons.className = "modal-buttons";

		const cancelBtn = document.createElement("button");
		cancelBtn.className = "btn-modal btn-modal-secondary";
		cancelBtn.type = "button";
		cancelBtn.innerText = "Annuler";

		const confirmBtn = document.createElement("button");
		confirmBtn.className = "btn-modal btn-modal-primary";
		confirmBtn.type = "button";
		confirmBtn.innerText = "Confirmer";

		function close(value) {
			document.removeEventListener("keydown", onKeyDown);
			overlay.remove();
			resolve(value);
		}

		function confirmAction() {
			const dateEffective = input.value.trim();

			if (!/^\d{2}[-\/]\d{2}[-\/]\d{4} \d{2}:\d{2}:\d{2}$/.test(dateEffective)) {
				error.innerText = "Format attendu : JJ-MM-AAAA HH:MM:SS";
				input.focus();
				return;
			}

			if (motifSelect && !motifSelect.value) {
				error.innerText = "Veuillez indiquer le motif réel de sortie.";
				motifSelect.focus();
				return;
			}

			close({
				dateEffective: dateEffective,
				membreAction: motifSelect ? motifSelect.value : defaultActionType
			});
		}

		function onKeyDown(event) {
			if (event.key === "Escape") {
				close(null);
			}

			if (event.key === "Enter") {
				confirmAction();
			}
		}

		cancelBtn.onclick = () => close(null);
		confirmBtn.onclick = confirmAction;
		overlay.onclick = event => {
			if (event.target === overlay) {
				close(null);
			}
		};

		buttons.appendChild(cancelBtn);
		buttons.appendChild(confirmBtn);
		modal.appendChild(title);
		modal.appendChild(details);
		modal.appendChild(label);
		modal.appendChild(input);
		modal.appendChild(motifWrapper);
		modal.appendChild(error);
		modal.appendChild(buttons);
		overlay.appendChild(modal);
		document.body.appendChild(overlay);
		document.addEventListener("keydown", onKeyDown);

		input.focus();
		input.select();
	});
}

function openEditMembreInfosModal(membre) {
	return new Promise(resolve => {
		const overlay = document.createElement("div");
		overlay.className = "modal-overlay";

		const modal = document.createElement("div");
		modal.className = "modal-action";

		const title = document.createElement("h2");
		title.innerText = "Modifier les informations";

		const details = document.createElement("p");
		details.className = "modal-action-details";
		details.innerText = membre.nom || "";

		const nomLabel = document.createElement("label");
		nomLabel.className = "modal-field-label";
		nomLabel.innerText = "Nom Discord";

		const nomInput = document.createElement("input");
		nomInput.className = "modal-date-input";
		nomInput.type = "text";
		nomInput.value = membre.nomDiscord || "";

		const idLabel = document.createElement("label");
		idLabel.className = "modal-field-label modal-field-label-spaced";
		idLabel.innerText = "ID Discord";

		const idInput = document.createElement("input");
		idInput.className = "modal-date-input";
		idInput.type = "text";
		idInput.value = membre.IDDiscord || "";

		const serveurLabel = document.createElement("label");
		serveurLabel.className = "modal-field-label modal-field-label-spaced";
		serveurLabel.innerText = "Serveur FRJ";

		const serveurSelect = document.createElement("select");
		serveurSelect.className = "modal-select";

		const inscritOption = document.createElement("option");
		inscritOption.value = "true";
		inscritOption.innerText = "Inscrit";

		const nonInscritOption = document.createElement("option");
		nonInscritOption.value = "false";
		nonInscritOption.innerText = "Non Inscrit";

		serveurSelect.appendChild(inscritOption);
		serveurSelect.appendChild(nonInscritOption);
		serveurSelect.value = isTrueField(membre.serveurFRJ) ? "true" : "false";

		const regleLabel = document.createElement("label");
		regleLabel.className = "modal-field-label modal-field-label-spaced";
		regleLabel.innerText = "Règles SOC";

		const regleSelect = document.createElement("select");
		regleSelect.className = "modal-select";

		const ouiOption = document.createElement("option");
		ouiOption.value = "true";
		ouiOption.innerText = "Oui";

		const nonOption = document.createElement("option");
		nonOption.value = "false";
		nonOption.innerText = "Non";

		regleSelect.appendChild(ouiOption);
		regleSelect.appendChild(nonOption);
		regleSelect.value = membre.regleSoc ? "true" : "false";

		const error = document.createElement("div");
		error.className = "modal-error";
		error.innerText = "";

		const buttons = document.createElement("div");
		buttons.className = "modal-buttons";

		const cancelBtn = document.createElement("button");
		cancelBtn.className = "btn-modal btn-modal-secondary";
		cancelBtn.type = "button";
		cancelBtn.innerText = "Annuler";

		const confirmBtn = document.createElement("button");
		confirmBtn.className = "btn-modal btn-modal-primary";
		confirmBtn.type = "button";
		confirmBtn.innerText = "Enregistrer";

		function close(value) {
			overlay.remove();
			resolve(value);
		}

		function confirmAction() {
			close({
				nomDiscord: nomInput.value.trim(),
				IDDiscord: idInput.value.trim(),
				regleSoc: regleSelect.value === "true",
				serveurFRJ: serveurSelect.value === "true"
			});
		}

		cancelBtn.onclick = () => close(null);
		confirmBtn.onclick = confirmAction;

		buttons.appendChild(cancelBtn);
		buttons.appendChild(confirmBtn);
		modal.appendChild(title);
		modal.appendChild(details);
		modal.appendChild(nomLabel);
		modal.appendChild(nomInput);
		modal.appendChild(idLabel);
		modal.appendChild(idInput);
		modal.appendChild(serveurLabel);
		modal.appendChild(serveurSelect);
		modal.appendChild(regleLabel);
		modal.appendChild(regleSelect);
		modal.appendChild(error);
		modal.appendChild(buttons);
		overlay.appendChild(modal);
		document.body.appendChild(overlay);

		nomInput.focus();
		nomInput.select();
	});
}

function initNouveauMembreForm() {
	console.log("Fonction : client.js - initNouveauMembreForm()");

	if (!isAdmin) {
		document.body.innerHTML = "";
		openInfoModal("Accès refusé", "Accès admin requis.", "error").then(() => {
			window.location.href = "actifs.html";
		});
		return;
	}

	const form = document.getElementById("nouveauMembreForm");
	const nomInput = document.getElementById("nomAvatar");
	const dateInput = document.getElementById("dateEffective");
	const message = document.getElementById("nouveauMembreMessage");
	const submitBtn = document.getElementById("btnCreerMembre");

	dateInput.value = getNowInputValue();
	nomInput.focus();

	form.addEventListener("submit", async event => {
		event.preventDefault();

		const nomAvatar = nomInput.value.trim();
		const dateEffective = dateInput.value.trim();

		message.className = "form-message";
		message.innerText = "";

		if (!nomAvatar) {
			await openInfoModal("Formulaire incomplet", "Nom d'Avatar obligatoire.", "error");
			nomInput.focus();
			return;
		}

		if (!/^\d{2}[-\/]\d{2}[-\/]\d{4} \d{2}:\d{2}:\d{2}$/.test(dateEffective)) {
			await openInfoModal("Date invalide", "Format attendu : JJ-MM-AAAA HH:MM:SS", "error");
			dateInput.focus();
			return;
		}

		submitBtn.disabled = true;
		submitBtn.innerText = "⏳ Vérification...";

		try {
			const result = await apiRequest("createOrOpenMembre", {
				nomAvatar: nomAvatar,
				dateEffective: dateEffective
			}, "POST");

			if (result.success === false) {
				throw new Error(result.error || "Erreur inconnue");
			}

			await openInfoModal(
				result.existing ? "Membre déjà présent" : "Membre créé",
				result.existing ? "Ouverture de la fiche existante." : "Ouverture de la nouvelle fiche.",
				"success"
			);

			window.location.href = "fiche.html?id=" + result.membreId;

		} catch (err) {
			console.error(err);
			await openInfoModal("Erreur", err.message || "Erreur lors de la création.", "error");
			submitBtn.disabled = false;
			submitBtn.innerText = "✅ Valider";
		}
	});
}

// ================================
// CARTE HISTORIQUE
// ================================
function buildCardHistorique(mouvements) {
	console.log("Fonction : client.js - buildCardHistorique(mouvements)");
  const card = document.createElement("div");
  card.className = "card";

  // S'assurer que mouvements est bien un tableau
  if (!Array.isArray(mouvements) || !mouvements.length) {
    card.innerHTML = "<p>Aucun mouvement.</p>";
    return card;
  }

  // Tri DESC sur la date
  mouvements.sort((a,b) => new Date(b.date) - new Date(a.date));

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
        <td>${formatDate(new Date(m.date))}</td>
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
	console.log("Fonction : client.js - loadMouvementsMensuels()");

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
	console.log("Fonction : client.js - displayMouvementsMensuels(container, mouvements)");

	const entrees = [];
	const sorties = [];
	const grades = [];
	const desertions = [];

	mouvements.forEach(m => {

		const date = formatDate(new Date(m.date));

		if (m.type === "ENTREE")
			entrees.push({
				id: m.id,
				label: `${m.nom} (${date})`
			});

		if (m.type === "SORTIE" || m.type === "BANNISSEMENT" || m.type === "DEMISSION")
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
	console.log("Fonction : client.js - buildCardListe(titre, items)");

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
	console.log("Fonction : client.js - renderMouvements()");

	const container = document.getElementById("mouvementsContainer");
	container.innerHTML = "";

	container.appendChild(buildCardFiltre());

	const filtered = mouvementsData.filter(m => {

		const d = new Date(m.date);

		return (
			d.getMonth() === moisCourant &&
			d.getFullYear() === anneeCourante
		);

	});

	displayMouvementsMensuels(container, filtered);

}

function getMoisIndex(mois, annee) {
	return annee * 12 + mois;
}

function getPremierMoisJournalise() {
	let premier = null;

	mouvementsData.forEach(m => {
		const d = new Date(m.date);

		if (isNaN(d.getTime())) return;

		const index = getMoisIndex(d.getMonth(), d.getFullYear());

		if (premier === null || index < premier) {
			premier = index;
		}
	});

	return premier;
}

function buildCardFiltre(){
	console.log("Fonction : client.js - buildCardFiltre()");

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

	const moisAffiche = getMoisIndex(moisCourant, anneeCourante);
	const moisActuel = getMoisIndex(new Date().getMonth(), new Date().getFullYear());
	const premierMois = getPremierMoisJournalise();
	const canGoPrev = premierMois === null || moisAffiche > premierMois;
	const canGoNext = moisAffiche < moisActuel;

	const prev = document.createElement("span");
	prev.innerHTML = "&#9664;&#9664;";
	prev.style.cursor = "pointer";
	prev.style.marginRight = "20px";

	if (canGoPrev) {
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
	}

	const next = document.createElement("span");
	next.innerHTML = "&#9654;&#9654;";
	next.style.cursor = "pointer";
	next.style.marginLeft = "20px";

	if (canGoNext) {
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
	}

	const label = document.createElement("span");
	label.innerText = moisNoms[moisCourant] + " " + anneeCourante;

	if (canGoPrev) {
		header.appendChild(prev);
	}

	header.appendChild(label);

	if (canGoNext) {
		header.appendChild(next);
	}

	card.appendChild(header);

	return card;

}
