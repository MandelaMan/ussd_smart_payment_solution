const loadEnv = () => {
  const {
    PORT = 3000,
    NODE_ENV = "development",
    MYSQL_HOST = "localhost",
    MYSQL_PORT = 3306,
    MYSQL_USER = "root",
    MYSQL_PASSWORD = "",
    MYSQL_DATABASE = "",
    MYSQL_CONNECTION_LIMIT = 10,
  } = process.env;

  return {
    PORT,
    NODE_ENV,
    MYSQL_HOST,
    MYSQL_PORT,
    MYSQL_USER,
    MYSQL_PASSWORD,
    MYSQL_DATABASE,
    MYSQL_CONNECTION_LIMIT,
  };
};

module.exports = { loadEnv };
