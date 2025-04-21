
const usersEl = document.querySelector('.table .users');

/*
socket.on('message', (message) => {

    if (message.type === 'userJoin') {

        const user = new User(message.user);

        Table.add(user);

    }

});



const Table;
*/
class User {

    constructor(userData) {

        const userEl = document.createElement('div');
        userEl.classList.add('user');

        userEl.innerHTML = `
            <div class="name">${userData.name}</div>
        `;

        usersEl.appendChild(userEl);

    }

}
