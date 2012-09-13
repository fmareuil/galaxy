/*
Backbone.js implementation of history panel

TODO:
    replicate then refactor (could be the wrong order)
    
    fix:
        tags
        annotations
    _render_displayApps
    _render_downloadButton
        widget building (popupmenu, etc.)
    
    don't draw body until it's first unhide event
    all history.mako js -> this
    HIview state transitions (eg. upload -> ok), curr: build new, delete old, place new (in render)
    History (meta controls : collapse all, rename, annotate, etc. - see history.js.120823.bak)
    events (local/ui and otherwise)
    HistoryCollection: (collection of History: 'Saved Histories')
    
    ?move IconButtonViews -> templates?
    
    convert function comments to jsDoc style, complete comments
    collection -> show_deleted, show_hidden
    poly HistoryItemView on: for_editing, display_structured, trans.user
    incorporate relations?
    localization
        template helper {{#local}} calls _l()

    move inline styles into base.less
    add classes, ids on empty divs
    watch the magic strings
*/

//==============================================================================

//==============================================================================
//TODO: move to Galaxy obj./namespace, decorate for current page (as GalaxyPaths)
/*
var Localizable = {
    localizedStrings : {},
    setLocalizedString : function( str, localizedString ){
        this.localizedStrings[ str ] = localizedString;
    },
    localize : function( str ){
        if( str in this.localizedStrings ){ return this.localizedStrings[ str ]; }
        return str;
    }
};
var LocalizableView = LoggingView.extend( Localizable );
*/
//TODO: wire up to views

//==============================================================================
// jq plugin?
//?? into template? I dunno: need to handle variadic keys, remove empty attrs (href="")
//TODO: not happy with this (a 4th rendering/templating system!?) or it being global
function linkHTMLTemplate( config, tag ){
    // Create an anchor (or any tag) using any config params passed in
    //NOTE!: send class attr as 'classes' to avoid res. keyword collision (jsLint)
    if( !config ){ return '<a></a>'; }
    tag = tag || 'a';
    
    var template = [ '<' + tag ];
    for( key in config ){
        var val = config[ key ];
        if( val === '' ){ continue; }
        switch( key ){
            case 'text': continue;
            case 'classes':
                // handle keyword class which is also an HTML attr name
                key = 'class';
                val = ( config.classes.join )?( config.classes.join( ' ' ) ):( config.classes );
                //note: lack of break (fall through)
            default:
                template.push( [ ' ', key, '="', val, '"' ].join( '' ) );
        }
    }
    template.push( '>' );
    if( 'text' in config ){ template.push( config.text ); }
    template.push( '</' + tag + '>' );
    
    return template.join( '' );
}

//==============================================================================
//TODO: use initialize (or validate) to check purged AND deleted -> purged XOR deleted
var HistoryItem = BaseModel.extend( LoggableMixin ).extend({
    // a single HDA model
    
    // uncomment this out see log messages
    //logger              : console,
    
    defaults : {
        
        id                  : null, 
        name                : '', 
        data_type           : null, 
        file_size           : 0, 
        genome_build        : null, 
        metadata_data_lines : 0, 
        metadata_dbkey      : null, 
        metadata_sequences  : 0, 
        misc_blurb          : '', 
        misc_info           : '', 
        model_class         : '', 
        state               : '',
        deleted             : false, 
        purged              : false,
        
        // clash with BaseModel here?
        visible             : true,
        
        for_editing         : true,
        // additional urls will be passed and added, if permissions allow their use
        
        bodyIsShown         : false
    },
    
    initialize : function(){
        this.log( this + '.initialize', this.attributes );
        this.log( '\tparent history_id: ' + this.get( 'history_id' ) );
        
        //TODO: accessible is set in alt_hist
        // this state is not in trans.app.model.Dataset.states - set it here
        if( !this.get( 'accessible' ) ){
            this.set( 'state', HistoryItem.STATES.NOT_VIEWABLE );
        }
    },

    isEditable : function(){
        // roughly can_edit from history_common.mako - not deleted or purged = editable
        return (
            //this.get( 'for_editing' )
            //&& !( this.get( 'deleted' ) || this.get( 'purged' ) )
            !( this.get( 'deleted' ) || this.get( 'purged' ) )
        );
    },
    
    hasData : function(){
        //TODO:?? is this equivalent to all possible hda.has_data calls?
        return ( this.get( 'file_size' ) > 0 );
    },

    toString : function(){
        var nameAndId = this.get( 'id' ) || '';
        if( this.get( 'name' ) ){
            nameAndId += ':"' + this.get( 'name' ) + '"';
        }
        return 'HistoryItem(' + nameAndId + ')';
    }
});

//------------------------------------------------------------------------------
HistoryItem.STATES = {
    NOT_VIEWABLE        : 'not_viewable',   // not in trans.app.model.Dataset.states
    NEW                 : 'new',
    UPLOAD              : 'upload',
    QUEUED              : 'queued',
    RUNNING             : 'running',
    OK                  : 'ok',
    EMPTY               : 'empty',
    ERROR               : 'error',
    DISCARDED           : 'discarded',
    SETTING_METADATA    : 'setting_metadata',
    FAILED_METADATA     : 'failed_metadata'
};


//==============================================================================
var HistoryItemView = BaseView.extend( LoggableMixin ).extend({
    //??TODO: add alias in initialize this.hda = this.model?
    // view for HistoryItem model above

    // uncomment this out see log messages
    //logger              : console,

    tagName     : "div",
    className   : "historyItemContainer",
    
    // ................................................................................ SET UP
    initialize  : function(){
        this.log( this + '.initialize:', this, this.model );
    },
   
    // ................................................................................ RENDER MAIN
    //??: this style builds an entire, new DOM tree - is that what we want??
    render : function(){
        var id = this.model.get( 'id' ),
            state = this.model.get( 'state' );
        this.clearReferences();
        
        this.$el.attr( 'id', 'historyItemContainer-' + id );
        
        var itemWrapper = $( '<div/>' ).attr( 'id', 'historyItem-' + id )
            .addClass( 'historyItemWrapper' ).addClass( 'historyItem' )
            .addClass( 'historyItem-' + state );
            
        itemWrapper.append( this._render_warnings() );
        itemWrapper.append( this._render_titleBar() );
        this.body = $( this._render_body() );
        itemWrapper.append( this.body );
        
        // set up canned behavior on children (bootstrap, popupmenus, editable_text, etc.)
        itemWrapper.find( '.tooltip' ).tooltip({ placement : 'bottom' });
        
        //TODO: broken
        var popupmenus = itemWrapper.find( '[popupmenu]' );
        popupmenus.each( function( i, menu ){
            menu = $( menu );
            make_popupmenu( menu );
        });
        
        //TODO: better transition/method than this...
        this.$el.children().remove();
        return this.$el.append( itemWrapper );
    },
    
    clearReferences : function(){
        //??TODO: best way?
        //?? do we really need these - not so far
        this.displayButton = null;
        this.editButton = null;
        this.deleteButton = null;
        this.errButton = null;
    },
    
    // ................................................................................ RENDER WARNINGS
    _render_warnings : function(){
        // jQ errs on building dom with whitespace - if there are no messages, trim -> ''
        return $( jQuery.trim( HistoryItemView.templates.messages( this.model.toJSON() ) ) );
    },
    
    // ................................................................................ RENDER TITLEBAR
    _render_titleBar : function(){
        var titleBar = $( '<div class="historyItemTitleBar" style="overflow: hidden"></div>' );
        titleBar.append( this._render_titleButtons() );
        titleBar.append( '<span class="state-icon"></span>' );
        titleBar.append( this._render_titleLink() );
        return titleBar;
    },

    // ................................................................................ display, edit attr, delete
    _render_titleButtons : function(){
        // render the display, edit attr and delete icon-buttons
        var buttonDiv = $( '<div class="historyItemButtons"></div>' );
        buttonDiv.append( this._render_displayButton() );
        buttonDiv.append( this._render_editButton() );
        buttonDiv.append( this._render_deleteButton() );
        return buttonDiv;
    },
    
    _render_displayButton : function(){
        // don't show display while uploading
        if( this.model.get( 'state' ) === HistoryItem.STATES.UPLOAD ){ return null; }
        
        // show a disabled display if the data's been purged
        displayBtnData = ( this.model.get( 'purged' ) )?({
            title       : 'Cannot display datasets removed from disk',
            enabled     : false,
            icon_class  : 'display'
            
        // if not, render the display icon-button with href 
        }):({
            title       : 'Display data in browser',
            href        : this.model.get( 'display_url' ),
            target      : ( this.model.get( 'for_editing' ) )?( 'galaxy_main' ):( null ),
            icon_class  : 'display'
        });
        this.displayButton = new IconButtonView({ model : new IconButton( displayBtnData ) });
        return this.displayButton.render().$el;
    },
    
    _render_editButton : function(){
        // don't show edit while uploading, or if editable
        if( ( this.model.get( 'state' ) === HistoryItem.STATES.UPLOAD )
        ||  ( !this.model.get( 'for_editing' ) ) ){
            return null;
        }
        
        var purged = this.model.get( 'purged' ),
            deleted = this.model.get( 'deleted' ),
            editBtnData = {
                title       : 'Edit attributes',
                href        : this.model.get( 'edit_url' ),
                target      : 'galaxy_main',
                icon_class  : 'edit'
            };
            
        // disable if purged or deleted and explain why in the tooltip
        //TODO: if for_editing
        if( deleted || purged ){
            editBtnData.enabled = false;
        }
        if( deleted ){
            editBtnData.title = 'Undelete dataset to edit attributes';
        } else if( purged ){
            editBtnData.title = 'Cannot edit attributes of datasets removed from disk';
        }
        
        this.editButton = new IconButtonView({ model : new IconButton( editBtnData ) });
        return this.editButton.render().$el;
    },
    
    _render_deleteButton : function(){
        // don't show delete if not editable
        if( !this.model.get( 'for_editing' ) ){ return null; }
        
        var deleteBtnData = {
            title       : 'Delete',
            href        : this.model.get( 'delete_url' ),
            target      : 'galaxy_main',
            id          : 'historyItemDeleter-' + this.model.get( 'id' ),
            icon_class  : 'delete'
        };
        if( ( this.model.get( 'deleted' ) || this.model.get( 'purged' ) )
        && ( !this.model.get( 'delete_url' ) ) ){
            deleteBtnData = {
                title       : 'Dataset is already deleted',
                icon_class  : 'delete',
                enabled     : false
            };
        }
        this.deleteButton = new IconButtonView({ model : new IconButton( deleteBtnData ) });
        return this.deleteButton.render().$el;
    },
    
    // ................................................................................ titleLink
    _render_titleLink : function(){
        return $( jQuery.trim( HistoryItemView.templates.titleLink( this.model.toJSON() ) ) );
    },

    // ................................................................................ RENDER BODY
    _render_hdaSummary : function(){
        var modelData = this.model.toJSON();
        // if there's no dbkey and it's editable : pass a flag to the template to render a link to editing in the '?'
        if( this.model.get( 'metadata_dbkey' ) === '?'
        &&  this.model.isEditable() ){
            _.extend( modelData, { dbkey_unknown_and_editable : true });
        }
        return HistoryItemView.templates.hdaSummary( modelData );
    },

    // ................................................................................ primary actions
    _render_primaryActionButtons : function( buttonRenderingFuncs ){
        var primaryActionButtons = $( '<div/>' ),
            view = this;
        _.each( buttonRenderingFuncs, function( fn ){
            primaryActionButtons.append( fn.call( view ) );
        });
        return primaryActionButtons;
    },
    
    _render_downloadButton : function(){
        // return either: a single download icon-button (if there are no meta files)
        //  or a popupmenu with links to download assoc. meta files (if there are meta files)
        
        // don't show anything if the data's been purged
        if( this.model.get( 'purged' ) ){ return null; }
        
        var downloadLink = linkHTMLTemplate({
            title       : 'Download',
            href        : this.model.get( 'download_url' ),
            classes     : [ 'icon-button', 'tooltip', 'disk' ]
        });
        
        // if no metafiles, return only the main download link
        var download_meta_urls = this.model.get( 'download_meta_urls' );
        if( !download_meta_urls ){
            return downloadLink;
        }
        
        // build the popupmenu for downloading main, meta files
        var popupmenu = $( '<div popupmenu="dataset-' + this.model.get( 'id' ) + '-popup"></div>' );
        popupmenu.append( linkHTMLTemplate({
            text        : 'Download Dataset',
            title       : 'Download',
            href        : this.model.get( 'download_url' ),
            classes     : [ 'icon-button', 'tooltip', 'disk' ]
        }));
        popupmenu.append( '<a>Additional Files</a>' );
        for( file_type in download_meta_urls ){
            popupmenu.append( linkHTMLTemplate({
                text        : 'Download ' + file_type,
                href        : download_meta_urls[ file_type ],
                classes     : [ 'action-button' ]
            }));
        }
        var menuButton = $( ( '<div style="float:left;" class="menubutton split popup"'
                          + ' id="dataset-${dataset_id}-popup"></div>' ) );
        menuButton.append( downloadLink );
        popupmenu.append( menuButton );
        return popupmenu;
    },
    
    //NOTE: button renderers have the side effect of caching their IconButtonViews to this view
    _render_errButton : function(){    
        if( ( this.model.get( 'state' ) !== HistoryItem.STATES.ERROR )
        ||  ( !this.model.get( 'for_editing' ) ) ){ return null; }
        
        this.errButton = new IconButtonView({ model : new IconButton({
            title       : 'View or report this error',
            href        : this.model.get( 'report_error_url' ),
            target      : 'galaxy_main',
            icon_class  : 'bug'
        })});
        return this.errButton.render().$el;
    },
    
    _render_showParamsButton : function(){
        // gen. safe to show in all cases
        this.showParamsButton = new IconButtonView({ model : new IconButton({
            title       : 'View details',
            href        : this.model.get( 'show_params_url' ),
            target      : 'galaxy_main',
            icon_class  : 'information'
        }) });
        return this.showParamsButton.render().$el;
    },
    
    _render_rerunButton : function(){
        if( !this.model.get( 'for_editing' ) ){ return null; }
        this.rerunButton = new IconButtonView({ model : new IconButton({
            title       : 'Run this job again',
            href        : this.model.get( 'rerun_url' ),
            target      : 'galaxy_main',
            icon_class  : 'arrow-circle'
        }) });
        return this.rerunButton.render().$el;
    },
    
    _render_tracksterButton : function(){
        var trackster_urls = this.model.get( 'trackster_urls' );
        if( !( this.model.hasData() )
        ||  !( this.model.get( 'for_editing' ) )
        ||  !( trackster_urls ) ){ return null; }
        
        this.tracksterButton = new IconButtonView({ model : new IconButton({
            title       : 'View in Trackster',
            icon_class  : 'chart_curve'
        })});
        this.errButton.render(); //?? needed?
        this.errButton.$el.addClass( 'trackster-add' ).attr({
            'data-url'  : trackster_urls[ 'data-url' ],
            'action-url': trackster_urls[ 'action-url' ],
            'new-url'   : trackster_urls[ 'new-url' ]
        });
        return this.errButton.$el;
    },
    
    // ................................................................................ secondary actions
    _render_secondaryActionButtons : function( buttonRenderingFuncs ){
        // move to the right (same level as primary)
        var secondaryActionButtons = $( '<div style="float: right;"></div>' ),
            view = this;
        _.each( buttonRenderingFuncs, function( fn ){
            secondaryActionButtons.append( fn.call( view ) );
        });
        return secondaryActionButtons;
    },

    _render_tagButton : function(){
        if( !( this.model.hasData() )
        ||  !( this.model.get( 'for_editing' ) )
        ||   ( !this.model.get( 'retag_url' ) ) ){ return null; }
        
        this.tagButton = new IconButtonView({ model : new IconButton({
            title       : 'Edit dataset tags',
            target      : 'galaxy_main',
            href        : this.model.get( 'retag_url' ),
            icon_class  : 'tags'
        })});
        return this.tagButton.render().$el;
    },

    _render_annotateButton : function(){
        if( !( this.model.hasData() )
        ||  !( this.model.get( 'for_editing' ) )
        ||   ( !this.model.get( 'annotate_url' ) ) ){ return null; }

        this.annotateButton = new IconButtonView({ model : new IconButton({
            title       : 'Edit dataset annotation',
            target      : 'galaxy_main',
            href        : this.model.get( 'annotate_url' ),
            icon_class  : 'annotate'
        })});
        return this.annotateButton.render().$el;
    },
    
    // ................................................................................ other elements
    _render_tagArea : function(){
        if( this.model.get( 'retag_url' ) ){ return null; }
        //TODO: move to mvc/tags.js
        return $( HistoryItemView.templates.tagArea( this.model.toJSON() ) );
    },
    
    _render_annotationArea : function(){
        if( !this.model.get( 'annotate_url' ) ){ return null; }
        //TODO: move to mvc/annotations.js
        return $( HistoryItemView.templates.annotationArea( this.model.toJSON() ) );
    },
    
    _render_displayApps : function(){
        if( !this.model.get( 'display_apps' ) ){ return null; }
        var displayApps = this.model.get( 'displayApps' ),
            displayAppsDiv = $( '<div/>' ),
            displayAppSpan = $( '<span/>' );
                
        this.log( this + 'displayApps:', displayApps );
        ////TODO: grrr...somethings not in the right scope here
        //for( app_name in displayApps ){
        //    //TODO: to template
        //    var display_app = displayApps[ app_name ],
        //        display_app_HTML = app_name + ' ';
        //    for( location_name in display_app ){
        //        display_app_HTML += linkHTMLTemplate({
        //            text    : location_name,
        //            href    : display_app[ location_name ].url,
        //            target  : display_app[ location_name ].target
        //        }) + ' ';
        //    }
        //    display_app_span.append( display_app_HTML );
        //}
        //displayAppsDiv.append( display_app_span );
        
        //displayAppsDiv.append( '<br />' );

        //var display_appsDiv = $( '<div/>' );
        //if( this.model.get( 'display_apps' ) ){
        //
        //    var display_apps = this.model.get( 'display_apps' ),
        //        display_app_span = $( '<span/>' );
        //        
        //    //TODO: grrr...somethings not in the right scope here
        //    for( app_name in display_apps ){
        //        //TODO: to template
        //        var display_app = display_apps[ app_name ],
        //            display_app_HTML = app_name + ' ';
        //        for( location_name in display_app ){
        //            display_app_HTML += linkHTMLTemplate({
        //                text    : location_name,
        //                href    : display_app[ location_name ].url,
        //                target  : display_app[ location_name ].target
        //            }) + ' ';
        //        }
        //        display_app_span.append( display_app_HTML );
        //    }
        //    display_appsDiv.append( display_app_span );
        //}
        ////display_appsDiv.append( '<br />' );
        //parent.append( display_appsDiv );
        return displayAppsDiv;
    },
            
    _render_peek : function(){
        if( !this.model.get( 'peek' ) ){ return null; }
        return $( '<div/>' ).append(
            $( '<pre/>' )
                .attr( 'id', 'peek' + this.model.get( 'id' ) )
                .addClass( 'peek' )
                .append( this.model.get( 'peek' ) )
        );
    },
    
    // ................................................................................ state body renderers
    // _render_body fns for the various states
    _render_body_not_viewable : function( parent ){
        //TODO: revisit - still showing display, edit, delete (as common) - that CAN'T be right
        parent.append( $( '<div>You do not have permission to view dataset.</div>' ) );
    },
    
    _render_body_uploading : function( parent ){
        parent.append( $( '<div>Dataset is uploading</div>' ) );
    },
        
    _render_body_queued : function( parent ){
        parent.append( $( '<div>Job is waiting to run.</div>' ) );
        parent.append( this._render_primaryActionButtons([
            this._render_showParamsButton,
            this._render_rerunButton
        ]));
    },
        
    _render_body_running : function( parent ){
        parent.append( '<div>Job is currently running.</div>' );
        parent.append( this._render_primaryActionButtons([
            this._render_showParamsButton,
            this._render_rerunButton
        ]));
    },
        
    _render_body_error : function( parent ){
        if( !this.model.get( 'purged' ) ){
            parent.append( $( '<div>' + this.model.get( 'misc_blurb' ) + '</div>' ) );
        }
        parent.append( ( 'An error occurred running this job: '
                       + '<i>' + $.trim( this.model.get( 'misc_info' ) ) + '</i>' ) );
        parent.append( this._render_primaryActionButtons([
            this._render_downloadButton,
            this._render_errButton,
            this._render_showParamsButton,
            this._render_rerunButton
        ]));
    },
        
    _render_body_discarded : function( parent ){
        parent.append( '<div>The job creating this dataset was cancelled before completion.</div>' );
        parent.append( this._render_primaryActionButtons([
            this._render_showParamsButton,
            this._render_rerunButton
        ]));
    },
        
    _render_body_setting_metadata : function( parent ){
        parent.append( $( '<div>Metadata is being auto-detected.</div>' ) );
    },
    
    _render_body_empty : function( parent ){
        //TODO: replace i with dataset-misc-info class 
        //?? why are we showing the file size when we know it's zero??
        parent.append( $( '<div>No data: <i>' + this.model.get( 'misc_blurb' ) + '</i></div>' ) );
        parent.append( this._render_primaryActionButtons([
            this._render_showParamsButton,
            this._render_rerunButton
        ]));
    },
        
    _render_body_failed_metadata : function( parent ){
        //TODO: the css for this box is broken (unlike the others)
        // add a message box about the failure at the top of the body...
        parent.append( $( HistoryItemView.templates.failedMetadata( this.model.toJSON() ) ) );
        //...then render the remaining body as STATES.OK (only diff between these states is the box above)
        this._render_body_ok( parent );
    },
        
    _render_body_ok : function( parent ){
        // most common state renderer and the most complicated
        parent.append( this._render_hdaSummary() );
        
        parent.append( this._render_primaryActionButtons([
            this._render_downloadButton,
            this._render_errButton,
            this._render_showParamsButton,
            this._render_rerunButton
        ]));
        parent.append( this._render_secondaryActionButtons([
            this._render_tagButton,
            this._render_annotateButton
        ]));
        parent.append( '<div class="clear"/>' );
        
        parent.append( this._render_tagArea() );
        parent.append( this._render_annotationArea() );
        
        parent.append( this._render_displayApps() );
        parent.append( this._render_peek() );
    },
    
    _render_body : function(){
        //this.log( this + '_render_body' );
        var state = this.model.get( 'state' );
        //this.log( 'state:', state, 'for_editing', for_editing );
        
        //TODO: incorrect id (encoded - use hid?)
        var body = $( '<div/>' )
            .attr( 'id', 'info-' + this.model.get( 'id' ) )
            .addClass( 'historyItemBody' )
            .attr(  'style', 'display: block' );
        
        //TODO: not a fan of this
        switch( state ){
            case HistoryItem.STATES.NOT_VIEWABLE :
                this._render_body_not_viewable( body ); 
				break;
            case HistoryItem.STATES.UPLOAD :
				this._render_body_uploading( body ); 
				break;
            case HistoryItem.STATES.QUEUED :
				this._render_body_queued( body ); 
				break;
            case HistoryItem.STATES.RUNNING :
				this._render_body_running( body ); 
				break;
            case HistoryItem.STATES.ERROR :
				this._render_body_error( body ); 
				break;
            case HistoryItem.STATES.DISCARDED :
				this._render_body_discarded( body ); 
				break;
            case HistoryItem.STATES.SETTING_METADATA :
				this._render_body_setting_metadata( body ); 
				break;
            case HistoryItem.STATES.EMPTY :
				this._render_body_empty( body ); 
				break;
            case HistoryItem.STATES.FAILED_METADATA :
				this._render_body_failed_metadata( body ); 
				break;
            case HistoryItem.STATES.OK :
				this._render_body_ok( body ); 
				break;
            default:
                //??: no body?
                body.append( $( '<div>Error: unknown dataset state "' + state + '".</div>' ) );
        }
            
        body.append( '<div style="clear: both"></div>' );
        if( this.model.get( 'bodyIsShown' ) === false ){
            body.hide();
        }
        return body;
    },

    // ................................................................................ EVENTS
    events : {
        'click .historyItemTitle'           : 'toggleBodyVisibility',
        'click a.icon-button.tags'          : 'loadAndDisplayTags',
        'click a.icon-button.annotate'      : 'loadAndDisplayAnnotation'
    },
    
    // ................................................................................ STATE CHANGES / MANIPULATION
    loadAndDisplayTags : function( event ){
        //BUG: broken with latest
        //TODO: this is a drop in from history.mako - should use MV as well
        this.log( this + '.loadAndDisplayTags', event );
        var tagArea = this.$el.find( '.tag-area' ),
            tagElt = tagArea.find( '.tag-elt' );

        // Show or hide tag area; if showing tag area and it's empty, fill it.
        if( tagArea.is( ":hidden" ) ){
            if( !tagElt.html() ){
                // Need to fill tag element.
                $.ajax({
                    url: this.model.get( 'ajax_get_tag_url' ),
                    error: function() { alert( "Tagging failed" ); },
                    success: function(tag_elt_html) {
                        tagElt.html(tag_elt_html);
                        tagElt.find(".tooltip").tooltip();
                        tagArea.slideDown("fast");
                    }
                });
            } else {
                // Tag element is filled; show.
                tagArea.slideDown("fast");
            }
            
        } else {
            // Hide.
            tagArea.slideUp("fast");
        }
        return false;        
    },
    
    loadAndDisplayAnnotation : function( event ){
        //BUG: broken with latest
        //TODO: this is a drop in from history.mako - should use MV as well
        this.log( this + '.loadAndDisplayAnnotation', event );
        var annotationArea = this.$el.find( '.annotation-area' ),
            annotationElem = annotationArea.find( '.annotation-elt' ),
            setAnnotationUrl = this.model.get( 'ajax_set_annotation_url' );

        // Show or hide annotation area; if showing annotation area and it's empty, fill it.
        if ( annotationArea.is( ":hidden" ) ){
            if( !annotationElem.html() ){
                // Need to fill annotation element.
                $.ajax({
                    url: this.model.get( 'ajax_get_annotation_url' ),
                    error: function(){ alert( "Annotations failed" ); },
                    success: function( htmlFromAjax ){
                        if( htmlFromAjax === "" ){
                            htmlFromAjax = "<em>Describe or add notes to dataset</em>";
                        }
                        annotationElem.html( htmlFromAjax );
                        annotationArea.find(".tooltip").tooltip();
                        
                        async_save_text(
                            annotationElem.attr("id"), annotationElem.attr("id"),
                            setAnnotationUrl,
                            "new_annotation", 18, true, 4
                        );
                        annotationArea.slideDown("fast");
                    }
                });
            } else {
                annotationArea.slideDown("fast");
            }
            
        } else {
            // Hide.
            annotationArea.slideUp("fast");
        }
        return false;        
    },

    toggleBodyVisibility : function(){
        this.log( this + '.toggleBodyVisibility' );
        this.$el.find( '.historyItemBody' ).toggle();
    },

    // ................................................................................ UTILTIY
    toString : function(){
        var modelString = ( this.model )?( this.model + '' ):( '' );
        return 'HistoryItemView(' + modelString + ')';    
    }
});


//------------------------------------------------------------------------------
//HistoryItemView.templates = InDomTemplateLoader.getTemplates({
HistoryItemView.templates = CompiledTemplateLoader.getTemplates({
    'common-templates.html' : {
        warningMsg      : 'template-warningmessagesmall'
    },
    'history-templates.html' : {
        messages        : 'template-history-warning-messages',
        titleLink       : 'template-history-titleLink',
        hdaSummary      : 'template-history-hdaSummary',
        failedMetadata  : 'template-history-failedMetaData',
        tagArea         : 'template-history-tagArea',
        annotationArea  : 'template-history-annotationArea'
    }
});

//==============================================================================
var HistoryCollection = Backbone.Collection.extend({
    model           : HistoryItem,
    
    toString        : function(){
         return ( 'HistoryCollection()' );
    }
});


//==============================================================================
var History = BaseModel.extend( LoggableMixin ).extend({
    
    // uncomment this out see log messages
    //logger              : console,

    // values from api (may need more)
    defaults : {
        id              : '', 
        name            : '', 
        state           : '', 
        state_details   : {
            discarded       : 0, 
            empty           : 0, 
            error           : 0, 
            failed_metadata : 0, 
            ok              : 0, 
            queued          : 0, 
            running         : 0, 
            setting_metadata: 0, 
            upload          : 0
        }
    },
    
    initialize : function( data, history_datasets ){
        this.log( this + '.initialize', data, history_datasets );
        this.items = new HistoryCollection();
    },

    loadDatasetsAsHistoryItems : function( datasets ){
        // adds the given dataset/Item data to historyItems
        //  and updates this.state based on their states
        //pre: datasets is a list of objs
        //this.log( this + '.loadDatasets', datasets );
        var self = this,
            selfID = this.get( 'id' ),
            stateDetails = this.get( 'state_details' );
            
        _.each( datasets, function( dataset, index ){
            self.log( 'loading dataset: ', dataset, index );
            
            // create an item sending along the history_id as well
            var historyItem = new HistoryItem(
                _.extend( dataset, { history_id: selfID } ) );
            self.log( 'as History:', historyItem );
            self.items.add( historyItem );
   
            // add item's state to running totals in stateDetails
            var itemState = dataset.state;
            stateDetails[ itemState ] += 1;
        });
        
        // get overall History state from totals
        this.set( 'state_details', stateDetails );
        this._stateFromStateDetails();
        return this;
    },
    
    _stateFromStateDetails : function(){
        // sets this.state based on current historyItems' states
        //  ported from api/histories.traverse
        //pre: state_details is current counts of dataset/item states
        this.set( 'state', '' );
        var stateDetails = this.get( 'state_details' );
        
        //TODO: make this more concise
        if( ( stateDetails.error > 0  )
        ||  ( stateDetails.failed_metadata > 0  ) ){
            this.set( 'state', HistoryItem.STATES.ERROR );
            
        } else if( ( stateDetails.running > 0  )
        ||         ( stateDetails.setting_metadata > 0  ) ){
            this.set( 'state', HistoryItem.STATES.RUNNING );
            
        } else if( stateDetails.queued > 0  ){
            this.set( 'state', HistoryItem.STATES.QUEUED );

        } else if( stateDetails.ok === this.items.length ){
            this.set( 'state', HistoryItem.STATES.OK );

        } else {
            throw( '_stateFromStateDetails: unable to determine '
                 + 'history state from state details: ' + this.state_details );
        }
        return this;
    },
    
    toString : function(){
        var nameString = ( this.get( 'name' ) )?
            ( ',' + this.get( 'name' ) ) : ( '' ); 
        return 'History(' + this.get( 'id' ) + nameString + ')';
    }
});

//------------------------------------------------------------------------------
var HistoryView = BaseView.extend( LoggableMixin ).extend({
    // view for the HistoryCollection (as per current right hand panel)
    
    // uncomment this out see log messages
    //logger              : console,

    // direct attachment to existing element
    el                  : 'body.historyPage',
    
    initialize  : function(){
        this.log( this + '.initialize' );
        this.itemViews = [];
        var parent = this;
        this.model.items.each( function( item ){
            var itemView = new HistoryItemView({ model: item });
            parent.itemViews.push( itemView );
        });
        //itemViews.reverse();
    },
    
    render      : function(){
        this.log( this + '.render' );
        
        // render to temp, move all at once, remove temp holder
        //NOTE!: render in reverse (newest on top) via prepend (instead of append)
        var tempDiv = $( '<div/>' );
        _.each( this.itemViews, function( view ){
            tempDiv.prepend( view.render() );
        });
        this.$el.append( tempDiv.children() );
        tempDiv.remove();
    },
    
    toString    : function(){
        var nameString = this.model.get( 'name' ) || '';
        return 'HistoryView(' + nameString + ')';
    }
});


//==============================================================================
function createMockHistoryData(){
    mockHistory = {};
    mockHistory.data = {
        
        template : {
            id                  : 'a799d38679e985db', 
            name                : 'template', 
            data_type           : 'fastq', 
            file_size           : 226297533, 
            genome_build        : '?', 
            metadata_data_lines : 0, 
            metadata_dbkey      : '?', 
            metadata_sequences  : 0, 
            misc_blurb          : '215.8 MB', 
            misc_info           : 'uploaded fastq file (misc_info)', 
            model_class         : 'HistoryDatasetAssociation', 
            download_url        : '', 
            state               : 'ok', 
            visible             : true,
            deleted             : false, 
            purged              : false,
            
            hid                 : 0,
            //TODO: move to history
            for_editing         : true,
            //for_editing         : false,
            
            //?? not needed
            //can_edit            : true,
            //can_edit            : false,
            
            accessible          : true,
            
            //TODO: move into model functions (build there (and cache?))
            //!! be careful with adding these accrd. to permissions
            //!!    IOW, don't send them via template/API if the user doesn't have perms to use
            //!!    (even if they don't show up)
            undelete_url        : '',
            purge_url           : '',
            unhide_url          : '',
            
            display_url         : 'example.com/display',
            edit_url            : 'example.com/edit',
            delete_url          : 'example.com/delete',
            
            show_params_url     : 'example.com/show_params',
            rerun_url           : 'example.com/rerun',
            
            retag_url           : 'example.com/retag',
            annotate_url        : 'example.com/annotate',
            
            peek                : [
                '<table cellspacing="0" cellpadding="3"><tr><th>1.QNAME</th><th>2.FLAG</th><th>3.RNAME</th><th>4.POS</th><th>5.MAPQ</th><th>6.CIGAR</th><th>7.MRNM</th><th>8.MPOS</th><th>9.ISIZE</th><th>10.SEQ</th><th>11.QUAL</th><th>12.OPT</th></tr>',
                '<tr><td colspan="100%">@SQ	SN:gi|87159884|ref|NC_007793.1|	LN:2872769</td></tr>',
                '<tr><td colspan="100%">@PG	ID:bwa	PN:bwa	VN:0.5.9-r16</td></tr>',
                '<tr><td colspan="100%">HWUSI-EAS664L:15:64HOJAAXX:1:1:13280:968	73	gi|87159884|ref|NC_007793.1|	2720169	37	101M	=	2720169	0	NAATATGACATTATTTTCAAAACAGCTGAAAATTTAGACGTACCGATTTATCTACATCCCGCGCCAGTTAACAGTGACATTTATCAATCATACTATAAAGG	!!!!!!!!!!$!!!$!!!!!$!!!!!!$!$!$$$!!$!!$!!!!!!!!!!!$!</td></tr>',
                '<tr><td colspan="100%">!!!$!$!$$!!$$!!$!!!!!!!!!!!!!!!!!!!!!!!!!!$!!$!!	XT:A:U	NM:i:1	SM:i:37	AM:i:0	X0:i:1	X1:i:0	XM:i:1	XO:i:0	XG:i:0	MD:Z:0A100</td></tr>',
                '<tr><td colspan="100%">HWUSI-EAS664L:15:64HOJAAXX:1:1:13280:968	133	gi|87159884|ref|NC_007793.1|	2720169	0	*	=	2720169	0	NAAACTGTGGCTTCGTTNNNNNNNNNNNNNNNGTGANNNNNNNNNNNNNNNNNNNGNNNNNNNNNNNNNNNNNNNNCNAANNNNNNNNNNNNNNNNNNNNN	!!!!!!!!!!!!$!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!</td></tr>',
                '<tr><td colspan="100%">!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!</td></tr>',
                '</table>'
            ].join( '' )
        }
        
    };
    _.extend( mockHistory.data, {
        
        notAccessible : 
            _.extend( _.clone( mockHistory.data.template ),
                      { accessible : false }),
        
        //deleted, purged, visible
        deleted     :
            _.extend( _.clone( mockHistory.data.template ),
                      { deleted : true,
                        delete_url : '',
                        purge_url : 'example.com/purge',
                        undelete_url : 'example.com/undelete' }),
        purgedNotDeleted :
            _.extend( _.clone( mockHistory.data.template ),
                      { purged : true,
                        delete_url : '' }),
        notvisible  :
            _.extend( _.clone( mockHistory.data.template ),
                      { visible : false,
                        unhide_url : 'example.com/unhide' }),

        hasDisplayApps :
            _.extend( _.clone( mockHistory.data.template ),
                { display_apps : {
                        'display in IGB' : {
                            Web: "/display_application/63cd3858d057a6d1/igb_bam/Web",
                            Local: "/display_application/63cd3858d057a6d1/igb_bam/Local"
                        }
                    }
                }
            ),
        canTrackster :
            _.extend( _.clone( mockHistory.data.template ),
                { trackster_urls      : {
                        'data-url'      : "example.com/trackster-data",
                        'action-url'    : "example.com/trackster-action",
                        'new-url'       : "example.com/trackster-new"
                    }
                }
            ),
        zeroSize  :
            _.extend( _.clone( mockHistory.data.template ),
                      { file_size : 0 }),
            
        hasMetafiles  :
            _.extend( _.clone( mockHistory.data.template ), {
                download_meta_urls : {
                    'bam_index'      : "example.com/bam-index"
                }
            }),
            
        //states
        upload :
            _.extend( _.clone( mockHistory.data.template ),
                      { state : HistoryItem.STATES.UPLOAD }),
        queued :
            _.extend( _.clone( mockHistory.data.template ),
                      { state : HistoryItem.STATES.QUEUED }),
        running :
            _.extend( _.clone( mockHistory.data.template ),
                      { state : HistoryItem.STATES.RUNNING }),
        empty :
            _.extend( _.clone( mockHistory.data.template ),
                      { state : HistoryItem.STATES.EMPTY }),
        error :
            _.extend( _.clone( mockHistory.data.template ),
                      { state : HistoryItem.STATES.ERROR,
                        report_error_url: 'example.com/report_err' }),
        discarded :
            _.extend( _.clone( mockHistory.data.template ),
                      { state : HistoryItem.STATES.DISCARDED }),
        setting_metadata :
            _.extend( _.clone( mockHistory.data.template ),
                      { state : HistoryItem.STATES.SETTING_METADATA }),
        failed_metadata :
            _.extend( _.clone( mockHistory.data.template ),
                      { state : HistoryItem.STATES.FAILED_METADATA })
/*
*/        
    });
    
    $( document ).ready( function(){
        //mockHistory.views.deleted.logger = console;
        mockHistory.items = {};
        mockHistory.views = {};
        for( key in mockHistory.data ){
            mockHistory.items[ key ] = new HistoryItem( mockHistory.data[ key ] );
            mockHistory.items[ key ].set( 'name', key );
            mockHistory.views[ key ] = new HistoryItemView({ model : mockHistory.items[ key ] });
            //console.debug( 'view: ', mockHistory.views[ key ] );
            $( 'body' ).append( mockHistory.views[ key ].render() );
        }
    });
}

