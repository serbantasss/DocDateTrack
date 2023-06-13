const mariadb = require('mariadb');

const pool = mariadb.createPool({
    host: '192.168.1.135',
    user: 'docu1',
    password: 'Ioana2503.',
    database: 'DocBase'
});

pool.getConnection()
    .then(conn => {
        console.log('Connected to MariaDB database');
        conn.release();
    })
    .catch(err => {
        console.log('Error connecting to MariaDB database:', err);
    });