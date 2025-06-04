// Navigation Prevention
// Set up navigation prevention immediately
let leaveWarningMessage = 'Are you sure you want to leave the game?'; // Default message

// Push initial states
history.pushState(null, '', window.location.href);
history.pushState(null, '', window.location.href);

// Handle back button and gesture
window.addEventListener('popstate', function (e) {
    // If we still have a state, prevent navigation
    if (history.state !== null) {
        e.preventDefault();
        history.pushState(null, '', window.location.href);
        return false;
    }
});

// Handle page unload
window.addEventListener('beforeunload', function (e) {
    e.preventDefault();
    e.returnValue = leaveWarningMessage;
    return e.returnValue;
});

// Load translations asynchronously and update the message
fetch('/static/translations/en.json')
    .then(response => response.json())
    .then(messages => {
        leaveWarningMessage = messages.navigation.leaveWarning;
    })
    .catch(error => {
        console.error('Error loading translations:', error);
    });