using { Attachments} from '@cap-js/attachments';
extend aspect Attachments with {
    folderId : String @title: 'Folder ID' @readonly;
    repositoryId : String @title: 'Repository ID' @readonly default null;
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
  note @(title: '{i18n>Note}');
  filename @(title: '{i18n>Filename}');
  modifiedAt @(odata.etag: null);
  content
      @Core.ContentDisposition: { Filename: filename, Type: 'inline' }
      @(title: '{i18n>Attachment}');
  folderId @UI.Hidden;
  mimeType @UI.Hidden;
  status @UI.Hidden;
  repositoryId @UI.Hidden;
}