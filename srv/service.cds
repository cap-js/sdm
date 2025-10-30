using { sap.attachments.Attachments } from '../index';

service AttachmentService {
  entity Attachments as projection on sap.attachments.Attachments;
  
  // Standard attachment actions
  action openAttachment() returns String;
  action createLink(name: String, url: String) returns String;
  action editLink(url: String) returns String;
  
  // Non-draft attachment operations (following CAP pattern)
  function getAttachments(entityId: String, @optional draftsOnly: Boolean) returns array of Attachments;
  function getAttachmentContent(ID: UUID) returns LargeBinary;
  
  action uploadAttachment(entityId: String, @Core.MediaType: 'multipart/form-data' content: LargeBinary, filename: String) returns Attachments;
  action updateAttachment(ID: UUID, @optional filename: String, @optional note: String) returns Attachments;
  action deleteAttachment(ID: UUID) returns Boolean;
  
  // Draft management (following CAP pattern)
  action activateDraft(entityId: String) returns Boolean;
  action discardDraft(entityId: String) returns Boolean;
  
  // Advanced operations
  action bulkDelete(IDs: array of UUID) returns Boolean;
  function getStatistics(entityId: String) returns {
    totalAttachments: Integer;
    totalDrafts: Integer;
    totalSize: Integer;
  };
}