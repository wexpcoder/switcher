module.exports = {
  checkPermissions: (member, permission, channel) => {
    if (!member.permissions.has(permission)) {
      channel.send('You lack the necessary permissions.');
      return false;
    }
    return true;
  },
};