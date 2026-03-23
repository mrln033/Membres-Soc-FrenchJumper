// ================================
// DATE UTILS (ISO SAFE)
// ================================

function parseDateISO(str) {
    if (!str) return null;

    // "YYYY-MM-DD HH:mm:ss"
    const [datePart, timePart = "00:00:00"] = str.split(" ");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, min, sec] = timePart.split(":").map(Number);

    return new Date(year, month - 1, day, hour, min, sec);
}

function formatDateISO(date) {
    if (!date) return "";

    const pad = (n) => ("0" + n).slice(-2);

    return (
        date.getFullYear() + "-" +
        pad(date.getMonth() + 1) + "-" +
        pad(date.getDate()) + " " +
        pad(date.getHours()) + ":" +
        pad(date.getMinutes()) + ":" +
        pad(date.getSeconds())
    );
}