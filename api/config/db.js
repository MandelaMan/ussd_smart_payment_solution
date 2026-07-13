const mysql = require("mysql2/promise");

let pool;

const getPool = () => {
  if (pool) return pool;

  const {
    MYSQL_HOST = "localhost",
    MYSQL_PORT = 3306,
    MYSQL_USER = "root",
    MYSQL_PASSWORD = "",
    MYSQL_DATABASE = "",
    MYSQL_CONNECTION_LIMIT = 10,
  } = process.env;

  pool = mysql.createPool({
    host: MYSQL_HOST,
    port: Number(MYSQL_PORT),
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: Number(MYSQL_CONNECTION_LIMIT),
    queueLimit: 0,
    timezone: "Z",
    multipleStatements: true, // ✅ allow schema.sql with many statements
  });

  return pool;
};

const query = async (sql, params = []) => {
  // Use text-protocol query() rather than execute() (prepared statements).
  // MySQL prepared statements reject or mis-handle LIMIT ? / INTERVAL ? DAY
  // with ER_WRONG_ARGUMENTS ("Incorrect arguments to mysqld_stmt_execute").
  const [rows] = await getPool().query(sql, params);
  return rows;
};

module.exports = { getPool, query };
