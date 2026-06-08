const adminState = {
    users: [],
    isLoading: false,
    busyUserIds: new Set()
};

function byId(id) {
    return document.getElementById(id);
}

function setMessage(message, isError = false) {
    const messageEl = byId('admin-message');
    messageEl.textContent = message || '';
    messageEl.hidden = !message;
    messageEl.classList.toggle('is-error', Boolean(message && isError));
    messageEl.classList.toggle('is-info', Boolean(message && !isError));
}

async function responseErrorMessage(response, fallbackMessage) {
    try {
        const rawText = await response.text();
        if (!rawText.trim()) {
            return fallbackMessage;
        }

        try {
            const data = JSON.parse(rawText);
            const message = data && (data.error || data.detail || data.message);
            return typeof message === 'string' && message.trim()
                ? message
                : fallbackMessage;
        } catch (parseError) {
            return rawText.trim();
        }
    } catch (readError) {
        return fallbackMessage;
    }
}

function formatDate(timestamp) {
    if (!timestamp) {
        return '-';
    }

    const normalized = String(timestamp).replace(' ', 'T');
    const date = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
    if (Number.isNaN(date.getTime())) {
        return timestamp;
    }

    return date.toLocaleString();
}

function appendTextCell(row, text, className = '') {
    const cell = document.createElement('td');
    cell.textContent = text;
    if (className) {
        cell.className = className;
    }
    row.appendChild(cell);
    return cell;
}

function visibilitySummary(stats) {
    const parts = [
        `${stats.private_worlds || 0} private`,
        `${stats.unlisted_worlds || 0} unlisted`,
        `${stats.public_worlds || 0} public`
    ];
    return parts.join(' / ');
}

function renderPasswordBadge(user) {
    const badge = document.createElement('span');
    badge.className = user.password_reset_required
        ? 'admin-badge reset'
        : 'admin-badge ok';

    const icon = document.createElement('i');
    icon.className = user.password_reset_required
        ? 'fas fa-key'
        : 'fas fa-check';
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.textContent = user.password_reset_required ? 'Reset' : 'OK';

    badge.appendChild(icon);
    badge.appendChild(text);
    return badge;
}

function renderActionButton(user) {
    const button = document.createElement('button');
    const shouldClear = Boolean(user.password_reset_required);
    button.type = 'button';
    button.className = shouldClear ? 'admin-action-btn clear' : 'admin-action-btn';
    button.disabled = adminState.busyUserIds.has(user.id);
    button.title = shouldClear ? 'Clear reset mode' : 'Set reset mode';

    const icon = document.createElement('i');
    icon.className = shouldClear ? 'fas fa-unlock' : 'fas fa-key';
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.textContent = shouldClear ? 'Clear' : 'Set';

    button.appendChild(icon);
    button.appendChild(text);
    button.addEventListener('click', () => {
        setPasswordResetRequired(user, !shouldClear);
    });

    return button;
}

function renderUsers() {
    const body = byId('users-table-body');
    body.replaceChildren();

    if (adminState.isLoading) {
        const row = document.createElement('tr');
        appendTextCell(row, 'Loading...', 'admin-empty').colSpan = 6;
        body.appendChild(row);
        return;
    }

    if (adminState.users.length === 0) {
        const row = document.createElement('tr');
        appendTextCell(row, 'No registered users yet.', 'admin-empty').colSpan = 6;
        body.appendChild(row);
        return;
    }

    adminState.users.forEach((user) => {
        const row = document.createElement('tr');
        const stats = user.stats || {};

        appendTextCell(row, user.username || '-', 'admin-username');
        appendTextCell(row, formatDate(user.created_at), user.created_at ? '' : 'admin-muted');
        appendTextCell(row, String(stats.total_worlds || 0));
        appendTextCell(row, visibilitySummary(stats), 'admin-muted');

        const passwordCell = document.createElement('td');
        passwordCell.appendChild(renderPasswordBadge(user));
        row.appendChild(passwordCell);

        const actionCell = document.createElement('td');
        actionCell.appendChild(renderActionButton(user));
        row.appendChild(actionCell);

        body.appendChild(row);
    });
}

function renderSummary() {
    const totalWorlds = adminState.users.reduce((count, user) => {
        return count + ((user.stats && user.stats.total_worlds) || 0);
    }, 0);
    const resetUsers = adminState.users.filter((user) => user.password_reset_required).length;

    byId('stat-users').textContent = String(adminState.users.length);
    byId('stat-worlds').textContent = String(totalWorlds);
    byId('stat-reset').textContent = String(resetUsers);
}

async function loadUsers() {
    adminState.isLoading = true;
    renderUsers();
    setMessage('');
    byId('refresh-users').disabled = true;

    try {
        const response = await fetch('/api/admin/users?limit=500');
        if (!response.ok) {
            throw new Error(await responseErrorMessage(response, 'Admin area unavailable'));
        }

        const data = await response.json();
        byId('admin-user').textContent = data.admin?.username || '-';
        adminState.users = Array.isArray(data.users) ? data.users : [];
        renderSummary();
    } catch (error) {
        adminState.users = [];
        renderSummary();
        setMessage(error.message || 'Failed to load users', true);
    } finally {
        adminState.isLoading = false;
        byId('refresh-users').disabled = false;
        renderUsers();
    }
}

async function setPasswordResetRequired(user, required) {
    adminState.busyUserIds.add(user.id);
    renderUsers();
    setMessage('');

    try {
        const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/password-reset`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                password_reset_required: required
            })
        });

        if (!response.ok) {
            throw new Error(await responseErrorMessage(response, 'Failed to update user'));
        }

        await loadUsers();
    } catch (error) {
        setMessage(error.message || 'Failed to update user', true);
    } finally {
        adminState.busyUserIds.delete(user.id);
        renderUsers();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    byId('refresh-users').addEventListener('click', loadUsers);
    loadUsers();
});
