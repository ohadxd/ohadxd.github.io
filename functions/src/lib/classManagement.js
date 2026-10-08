"use strict";

async function deleteClassRecords(db, classCode, publicSeatMapId) {
  const classRef = db.collection("classAccessCodes").doc(classCode);
  const publicSeatMapRef = db.collection("publicSeatMaps").doc(publicSeatMapId);

  return db.runTransaction(async (transaction) => {
    const classSnapshot = await transaction.get(classRef);
    if (!classSnapshot.exists) return false;

    const seats = await transaction.get(classRef.collection("seats"));
    for (const seat of seats.docs) {
      transaction.delete(seat.ref);
    }
    transaction.delete(publicSeatMapRef);
    transaction.delete(classRef);
    return true;
  });
}

module.exports = { deleteClassRecords };
