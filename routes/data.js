const {Firestore} = require('@google-cloud/firestore');
const fetch = require('node-fetch');

// Database Initialization
let firestore = new Firestore();

/**
 * Utility function that returns the correct collection name depending on whther the environment is PRODUCTION or DEVELOPMENT.
 * @param {String} collectionName
 * @return {string} the collection name under the current node environment
 */
function resolveCollectionName(collectionName) {
  return process.env.NODE_ENV == 'production' ? collectionName : 'dev-' + collectionName;
}

exports.setDatabase = (firestoreInstance) => (firestore = firestoreInstance);

exports.getDatabase = () => firestore;

/**
 * Queries for all AcceptedCategories by either organization or category depending on the document reference and fieldName
 * @param {FirebaseFirestore.DocumentReference} ref
 * @param {String} fieldName
 * @return {Array} array of all AcceptedCategories that match the reference
 */
async function getAcceptedCategoriesByRef(ref, fieldName) {
  const snapshot = await firestore
    .collection(resolveCollectionName('AcceptedCategories'))
    .where(fieldName, '==', ref)
    .get();
  const results = {};
  snapshot.docs.forEach((doc) => {
    results[doc.id] = doc.data();
  });
  return results;
}

/**
 * Fetches all organizations from the database.
 * @param {User} user The user from the request.
 * @return {array} The list of all organizations.
 */
exports.getAllOrganizations = async function (user) {
  const organizations = await firestore.collection(resolveCollectionName('Organizations')).get();

  const parsedOrganizations = [];

  for (const doc of organizations.docs) {
    const data = doc.data();
    data['id'] = doc.id;
    data['favorite'] = await isFavoriteOfMember(doc.id, user);
    data['categories'] = await getOrganizationCategories(doc.ref);

    parsedOrganizations.push(data);
  }

  return parsedOrganizations;
};

/**
 * Queries the database for organizations with the given item category.
 * @param {String} filter The category name to filter organizations by.
 * @param {User} user The user from the request.
 * @return {array} The list of filtered organizations.
 */
exports.getFilteredOrganizations = async function (filter, user) {
  filter = filter.toLowerCase();

  const categoryReference = await firestore
    .collection(resolveCollectionName('Categories'))
    .doc(filter);
  const acceptedCategories = await getAcceptedCategoriesByRef(categoryReference, 'category');

  const organizations = [];

  for (const acceptedCategoryId in acceptedCategories) {
    if (Object.prototype.hasOwnProperty.call(acceptedCategories, acceptedCategoryId)) {
      const organizationReference = acceptedCategories[acceptedCategoryId].organization;
      const organizationSnapshot = await organizationReference.get();

      const organization = organizationSnapshot.data();
      organization['id'] = organizationSnapshot.id;
      organization['favorite'] = await isFavoriteOfMember(organizationSnapshot.id, user);
      organization['categories'] = await getOrganizationCategories(organizationReference);

      organizations.push(organization);
    }
  }
  return organizations;
};

/**
 * Gets all categories from the firestore database.
 * @return {array} The list of categories.
 */
exports.getCategories = async function () {
  const snapshot = await firestore.collection(resolveCollectionName('Categories')).get();
  return snapshot.docs.map((doc) => doc.id);
};

/**
 * Gets the reference to the user's Member document
 * @param {User} user User object set by Passport.js
 * @return {DocumentReference} reference to a Member document
 */
async function getMemberReference(user) {
  // If user is not authenticated then return no authorized
  if (!user) {
    return undefined;
  }

  const memberQuery = await firestore
    .collection(resolveCollectionName('Members'))
    .where('authenticationID', '==', user.id)
    .get();

  return memberQuery.docs[0].ref;
}

/**
 * @param {String} organizationID ID  of organanization
 * @param {User} user User object set by Passport.js
 * @return {boolean} true if organization is in member's favorite
 */
async function isFavoriteOfMember(organizationID, user) {
  // If user is not authenticated then return false
  if (!user) {
    return false;
  }

  const memberRef = await getMemberReference(user);
  const organizationRef = await firestore
    .collection(resolveCollectionName('Organizations'))
    .doc(organizationID);

  // If organization is a favorite of the member then this query should
  // return a result of one entry in Favorites.
  const favoritesSnapshot = await firestore
    .collection(resolveCollectionName('Favorites'))
    .where('member', '==', memberRef)
    .where('organization', '==', organizationRef)
    .get();

  const isFavorite = favoritesSnapshot.docs.length == 1;
  return isFavorite;
}

/**
 * Retrieves the list of categories accepted by an organization.
 * @param {Reference} organizationReference The Firestore reference to an organization.
 * @return {Array} The list of accepted categories by the organization.
 */
async function getOrganizationCategories(organizationReference) {
  const categories = [];
  const acceptedCategories = await getAcceptedCategoriesByRef(
    organizationReference,
    'organization'
  );
  for (const key in acceptedCategories) {
    if (Object.prototype.hasOwnProperty.call(acceptedCategories, key)) {
      const category = acceptedCategories[key].category.id;
      categories.push(category);
    }
  }
  return categories;
}

/* Response Handlers */

exports.acceptedCategoriesGet = async function (req, res) {
  const doc = await firestore
    .collection(resolveCollectionName('AcceptedCategories'))
    .doc(req.params['id'])
    .get();

  if (doc.exists) {
    res.send(doc.data());
  } else {
    res.sendStatus(404);
  }
};

exports.acceptedCategoriesPost = async function (req, res) {
  const updatedAcceptedCategoryData = req.body;

  // If there is an update to the category field then change string into DocumentReference
  if ('category' in updatedAcceptedCategoryData) {
    updatedAcceptedCategoryData.category = await firestore.doc(
      `/${resolveCollectionName('Categories')}/${req.body.category}`
    );
  }

  await firestore
    .collection(`${resolveCollectionName('AcceptedCategories')}`)
    .doc(`${req.params.id}`)
    .update(updatedAcceptedCategoryData);
  res.sendStatus(201);
};

exports.acceptedCategoriesDelete = async function (req, res) {
  await firestore
    .collection(`${resolveCollectionName('AcceptedCategories')}`)
    .doc(`${req.params.id}`)
    .delete();
  res.sendStatus(200);
};

exports.acceptedCategoriesByFieldGet = async function (req, res) {
  let fieldReference;

  if (req.params.field == 'organization') {
    fieldReference = firestore
      .collection(resolveCollectionName('Organizations'))
      .doc(req.params.id);
  } else if (req.params.field == 'category') {
    fieldReference = firestore.collection(resolveCollectionName('Categories')).doc(req.params.id);
  }

  const results = await getAcceptedCategoriesByRef(fieldReference, req.params.field);

  res.send(results);
};

exports.acceptedCategoriesOrganizationPost = async function (req, res) {
  const newAcceptedCategoryData = req.body;
  newAcceptedCategoryData.organization = await firestore
    .collection(`${resolveCollectionName('Organizations')}`)
    .doc(`${req.params.id}`);
  newAcceptedCategoryData.category = await firestore
    .collection(`${resolveCollectionName('Categories')}`)
    .doc(`${req.body.category}`);

  // Check if the organization already has accepted the category.
  const existingCategory = await firestore
    .collection(resolveCollectionName('AcceptedCategories'))
    .where('category', '==', newAcceptedCategoryData.category)
    .where('organization', '==', newAcceptedCategoryData.organization)
    .get();

  // If the category is not found, set it. Otherwise, update the existing one.
  if (existingCategory.docs.length == 0) {
    await firestore
      .collection(resolveCollectionName('AcceptedCategories'))
      .doc()
      .set(newAcceptedCategoryData);
  } else {
    const acceptedReference = await existingCategory.docs[0].ref._path.segments;
    await firestore
      .collection(acceptedReference[0])
      .doc(acceptedReference[1])
      .update(newAcceptedCategoryData);
  }
  res.sendStatus(201);
};

exports.getMember = async function (req, res) {
  const memberData = req.user;
  const userData = {
    authenticationID: memberData.id,
    name: memberData.displayName,
    email: memberData.emails[0].value,
  };
  const memberSnapshot = await firestore
    .collection(resolveCollectionName('Members'))
    .where('authenticationID', '==', memberData.id);

  memberSnapshot.get().then(function (doc) {
    // Check if a member with the specified authentication ID exists.
    if (doc.docs[0]) {
      // If the member is found, send their ID.
      res.json({id: doc.docs[0].id});
    } else {
      // Otherwise, create a new member.
      firestore
        .collection(resolveCollectionName('Members'))
        .doc()
        .set(userData)
        .then(res.json({id: null}));
    }
  });
};

exports.getOrganizationFromMember = async function (req, res) {
  const organizationReference = firestore
    .collection(resolveCollectionName('Organizations'))
    .doc(req.params.id);

  const memberAssignments = await firestore
    .collection(resolveCollectionName('MemberAssignments'))
    .where('organization', '==', organizationReference)
    .get();

  const memberReference = await memberAssignments.docs[0].data().member._path.segments;
  const memberInfo = await firestore.collection(memberReference[0]).doc(memberReference[1]).get();
  res.send(memberInfo.data());
};

exports.getMemberFromOrganization = async function (req, res) {
  const memberReference = firestore.collection(resolveCollectionName('Members')).doc(req.params.id);

  const memberAssignments = await firestore
    .collection(resolveCollectionName('MemberAssignments'))
    .where('member', '==', memberReference)
    .get();
  const organizationDoc = await memberAssignments.docs[0];

  // Return undefined if the organization hasn't been approved yet.
  if (!organizationDoc) {
    res.json({id: undefined});
    return;
  }

  const organizationReference = organizationDoc.data().organization._path.segments;

  const organizationInfo = await firestore
    .collection(organizationReference[0])
    .doc(organizationReference[1])
    .get();

  res.json({id: organizationInfo.id});
};

exports.organizationsGet = async function (req, res) {
  const organization = await firestore
    .collection(resolveCollectionName('Organizations'))
    .doc(`${req.params.id}`)
    .get();

  if (organization.exists) {
    res.send(organization.data());
  } else {
    res.sendStatus(404);
  }
};

exports.organizationsPost = async function (req, res) {
  const newOrgData = req.body;

  const placeJSON = await (
    await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${newOrgData.address}&key=${process.env.MAPS_KEY}`
    )
  ).json();
  newOrgData.coordinates = placeJSON.results[0].geometry.location;

  newOrgData.acceptsDropOff = !!newOrgData.acceptsDropOff;
  newOrgData.acceptsPickUp = !!newOrgData.acceptsPickUp;
  newOrgData.acceptsShipping = !!newOrgData.acceptsShipping;
  await firestore
    .collection(resolveCollectionName('Organizations'))
    .doc(`${req.params.id}`)
    .update(newOrgData);
  res.redirect('/dashboard');
};

exports.getFavorites = async function (req, res) {
  // If user is not authenticated then return no authorized
  if (!req.user) {
    res.sendStatus(401);
    return;
  }

  const memberRef = await getMemberReference(req.user);
  const favoritesSnapshot = await firestore
    .collection(resolveCollectionName('Favorites'))
    .where('member', '==', memberRef)
    .get();

  const results = [];
  await Promise.all(
    favoritesSnapshot.docs.map(async (doc) => {
      const orgReference = await doc.data().organization._path.segments;
      const orgInfo = await firestore.collection(orgReference[0]).doc(orgReference[1]).get();
      const categories = await getOrganizationCategories(orgInfo.ref);
      const orgData = await orgInfo.data();
      results.push({
        ...orgData,
        id: orgInfo.id,
        favorite: true,
        categories: categories,
      });
    })
  );
  res.json({
    organizations: results,
    isLoggedIn: true,
  });
};

exports.postFavorite = async function (req, res) {
  // If user is not authenticated then return no authorized
  if (!req.user) {
    res.sendStatus(401);
    return;
  }

  const memberRef = await getMemberReference(req.user);
  const organizationRef = await firestore
    .collection(resolveCollectionName('Organizations'))
    .doc(req.params.organizationID);

  const newFavoritesEntry = {
    member: memberRef,
    organization: organizationRef,
  };

  await firestore.collection(resolveCollectionName('Favorites')).doc().set(newFavoritesEntry);
  res.sendStatus(201);
};

exports.deleteFavorite = async function (req, res) {
  // If user is not authenticated then return no authorized
  if (!req.user) {
    res.sendStatus(401);
    return;
  }

  const memberRef = await getMemberReference(req.user);
  const organizationRef = await firestore
    .collection(resolveCollectionName('Organizations'))
    .doc(req.params.organizationID);

  /*
   * Get Favorites entry document
   */
  const favoritesSnapshot = await firestore
    .collection(resolveCollectionName('Favorites'))
    .where('member', '==', memberRef)
    .where('organization', '==', organizationRef)
    .get();

  // Delete the entry
  await favoritesSnapshot.docs[0].ref.delete();
  res.sendStatus(200);
};
