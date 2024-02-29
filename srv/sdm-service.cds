
service SDMService {
@cds.persistence.skip
entity CmisObject{
key id: String;
objectId: String;
baseTypeId: String;
versionSeriesId: String;
versionSeriesCheckedOutId: String;
objectTypeId: String;
name: String;
isMajorVersion: Boolean;
description: String;
contentStreamMimeType: String;
contentStreamId: String;
contentStreamLength: Integer;
contentStreamFileName: String;
isLatestMajorVersion: Boolean;
isPrivateWorkingCopy:Boolean;
isLatestVersion:Boolean;
isImmutable:Boolean;
path: String;
parentId: String;
checkinComment: String;
versionLabel: String;
isVersionSeriesCheckedOut: String;
createdBy: String;
creationDate: String;
lastModifiedBy: String;
lastModificationDate: String;
versionSeriesCheckedOutBy: String;
changeToken: String;
}

@cds.persistence.skip
entity CmisExtensionType{
key extTypeId:String;
baseTypeId:String;
lastModifiedBy:String;
createdBy:String;
lastModificationDate:String;
creationDate:String;
localName:String;
localNamespace:String;
queryName:String;
displayName:String;
parentId:String;
description:String;
creatable : Boolean;
fileable : Boolean;
queryable : Boolean;
controllablePolicy: String;
controllableACL: String;
fulltextIndexed: Boolean;
includedInSupertypeQuery :Boolean;
}

@cds.persistence.skip
entity CmisTypeProperty{
key id :String ;
extTypeId :String;
lastModifiedBy:String;
createdBy :String;
lastModificationDate :String;
creationDate :String;
localName :String;
localNamespace :String;
queryName :String;
displayName :String;
propertyType :String;
description :String;
cardinality :String;
updatability :String;
inherited :Boolean;
required :Boolean;
queryable: Boolean;
orderable :Boolean;
openChoice :Boolean;
defaultValue :String;
maxLength :Integer;
precision :String;
minValue :Integer;
maxValue :Integer;
resolution :Integer;
choices :String;
}
@cds.persistence.skip
entity CmisTypeObject{
key id :String;
objectId :String;
extTypeId :String;
lastModifiedBy :String;
createdBy :String;
lastModificationDate :String;
creationDate :String;
}

@cds.persistence.skip
entity CmisTypePropertyData{
key id :String ;
objectId :String;
typeObjectMappingId :String;
lastModifiedBy :String;
createdBy :String;
lastModificationDate :String;
creationDate :String;
typePropertyId :String;
propertyValue :String;
}
}
