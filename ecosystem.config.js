module.exports = {
  apps: [{
    name: 'muscle-fitness',
    script: 'server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env_production: { NODE_ENV: 'production' }
  }]
}
