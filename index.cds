using { sap.attachments.Attachments } from '@cap-js/attachments';
extend aspect Attachments with {
    folderId : String @title: 'Folder ID' @readonly;
    repositoryId : String @title: 'Repository ID' @readonly default null;
    linkUrl: String @(title: '{i18n>LinkURL}') default null;
    type: String @(title: '{i18n>Type}') @(UI: {IsImageURL: true}) default 'sap-icon://document';
    holdId: String @title: 'Hold ID' @readonly default null;
};
annotate Attachments with @UI:{
  HeaderInfo: {
    $Type         : 'UI.HeaderInfoType',
    TypeName      : '{i18n>Attachment}',
    TypeNamePlural: '{i18n>Attachments}',
  },
  LineItem: [
    {Value: filename, @HTML5.CssDefaults: {width: '20%'}},
    {Value: content, @HTML5.CssDefaults: {width: '20%'}},
    {Value: createdAt, @HTML5.CssDefaults: {width: '20%'}},
    {Value: createdBy, @HTML5.CssDefaults: {width: '20%'}},
    {Value: note, @HTML5.CssDefaults: {width: '20%'}}
  ]
} {
  url @readonly;
  note @(title: '{i18n>Note}') @Common.FieldControl: {$edmJson: {$If: [{$Eq: [{$Path: 'holdId'}, 'SDM_PLUGIN_HOLD']}, 1, 3]}};
  filename @(title: '{i18n>Filename}') @Common.FieldControl: {$edmJson: {$If: [{$Eq: [{$Path: 'holdId'}, 'SDM_PLUGIN_HOLD']}, 1, 3]}};
  modifiedAt @(odata.etag: null);
  content
      @Core.ContentDisposition: { Filename: filename, Type: 'inline' }
      @(title: '{i18n>Attachment}');
  folderId @UI.Hidden;
  mimeType @UI.Hidden;
  status @UI.Hidden;
  repositoryId @UI.Hidden;
  holdId @UI.Hidden;
}
