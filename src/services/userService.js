const userRepository = require("../repositories/userRepository");

async function getMe(userId) {
  return userRepository.publicUser(await userRepository.findById(userId));
}

async function updateMe(userId, payload) {
  return userRepository.updateProfile(userId, payload);
}

module.exports = {
  getMe,
  updateMe
};
