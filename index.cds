using { Attachments} from '@cap-js/attachments';
extend aspect Attachments with {
    folderId : String @title: 'Folder ID' @readonly;
    repositoryId : String @title: 'Repository ID' @readonly default null;
};
annotate Attachments with @UI:{
  HeaderInfo: {
    TypeName: '{i18n>Attachment}',
    TypeNamePlural: '{i18n>Attachments}',
  },
  LineItem: [
    {Value: filename},
    {Value: content},
    {Value: createdAt},
    {Value: createdBy},
    {Value: note}
  ]
} {
  url @readonly;
  content
    @Core.ContentDisposition: { Filename: filename }
    @Core.Immutable
}